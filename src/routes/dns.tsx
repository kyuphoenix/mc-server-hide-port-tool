import type { Hono } from 'hono'
import { getCurrentSession } from '../auth'
import { getSettings } from '../services/settings'
import {
  beginRecordUpdate,
  countRecordsByUser,
  deleteRecordRow,
  finalizeRecordSync,
  findRecordByHostName,
  findRecordById,
  findUserById,
  insertPendingRecord,
  markRecordSyncError,
  persistRecordRemoteIds,
  resolveMinSubdomainLength,
  resolveUserRecordLimit
} from '../services/dns-records'
import {
  createDnsRecord,
  deleteCloudflareDnsRecord,
  deleteRecordAndCloudflare,
  fetchZoneId,
  findOccupiedRecords,
  getAllowedDomains,
  getCloudflareApiToken,
  isCloudflareDnsError,
  parseCreateDnsRequest,
  parseUpdateDnsRequest,
  toDnsFailureEvent,
  updateDnsRecord,
  type Bindings
} from '../services/cloudflare-dns'
import { isSameOriginMutation, verifyCsrfToken } from '../lib/security'
import {
  DNS_CONFIG_SAFE_MESSAGE,
  DNS_GENERIC_SAFE_MESSAGE,
  logDnsExternalServiceFailure,
  safeDnsClientMessage
} from '../lib/external-service-security'
import { sensitiveDataKeysFromEnv } from '../services/sensitive-data'


async function requireDnsMutationAuth(c: any): Promise<Response | null> {
  if (!isSameOriginMutation(c.req.raw)) {
    return c.json({ success: false, message: 'Forbidden: invalid origin' }, 403)
  }
  const csrfHeader = c.req.header('x-csrf-token') || ''
  // Cookie-authenticated JSON mutations must include CSRF header matching cookie.
  if (!verifyCsrfToken(c.req.header('Cookie'), csrfHeader)) {
    return c.json({ success: false, message: 'Forbidden: invalid CSRF token' }, 403)
  }
  return null
}

function dnsExternalErrorResponse(
  c: any,
  error: unknown,
  fallbackStage: Parameters<typeof toDnsFailureEvent>[1]
): Response {
  const event = toDnsFailureEvent(error, fallbackStage)
  logDnsExternalServiceFailure(event)
  return c.json({ success: false, message: safeDnsClientMessage(event.code) }, 500)
}

function remoteRecordByNameAndType<T extends { name: string; type: string }>(
  records: T[],
  name: string,
  type: string
): T | null {
  const expectedName = name.toLowerCase().replace(/\.$/, '')
  const expectedType = type.toUpperCase()
  return records.find((record) =>
    record.name.toLowerCase().replace(/\.$/, '') === expectedName &&
    record.type.toUpperCase() === expectedType
  ) ?? null
}

function syncErrorCode(error: unknown, stage: Parameters<typeof toDnsFailureEvent>[1]): string {
  return toDnsFailureEvent(error, stage).code
}

export function registerDnsRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.get('/api/domains', async (c) => {
    const domains = getAllowedDomains(c.env)
    const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
    const session = await getCurrentSession(c.env, c.req.raw.headers)
    let recordLimit: number | null = null
    let minSubdomainLength = Math.max(0, settings.min_subdomain_length)
    let recordCount = 0
    if (session) {
      const userRow = await findUserById(c.env.DB, session.user.id)
      recordLimit = resolveUserRecordLimit(userRow, settings.max_records_per_user)
      minSubdomainLength = resolveMinSubdomainLength(userRow, settings.min_subdomain_length)
      recordCount = await countRecordsByUser(c.env.DB, session.user.id)
    }
    return c.json({
      success: true,
      domains,
      min_subdomain_length: minSubdomainLength,
      record_limit: recordLimit,
      record_count: recordCount,
      max_records_per_user: settings.max_records_per_user
    })
  })

  app.post('/api/create-dns', async (c) => {
    try {
      const session = await getCurrentSession(c.env, c.req.raw.headers)
      if (!session) {
        return c.json({ success: false, message: '未登录，请先登录' }, 401)
      }
      const csrfDenied = await requireDnsMutationAuth(c)
      if (csrfDenied) return csrfDenied
      const userId = session.user.id
      const userRow = await findUserById(c.env.DB, userId)

      const body = await c.req.json()
      const domains = getAllowedDomains(c.env)

      if (domains.length === 0) {
        logDnsExternalServiceFailure({ code: 'DNS_CONFIG_MISSING', stage: 'config' })
        return c.json({ success: false, message: DNS_CONFIG_SAFE_MESSAGE }, 500)
      }

      const request = parseCreateDnsRequest(body, domains)
      if (!request.ok) {
        return c.json({ success: false, message: request.message }, 400)
      }

      const { subdomain, rootDomain, serverAddress, port, targetRecordType } = request.value
      const token = getCloudflareApiToken(c.env, rootDomain)
      if (!token) {
        logDnsExternalServiceFailure({ code: 'DNS_CONFIG_MISSING', stage: 'config' })
        return c.json({ success: false, message: DNS_CONFIG_SAFE_MESSAGE }, 500)
      }

      const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
      const minLen = resolveMinSubdomainLength(userRow, settings.min_subdomain_length)
      const subdomainInput = String((body as Record<string, unknown>).subdomain ?? '').trim()
      if (minLen > 0 && subdomainInput.length < minLen) {
        return c.json(
          {
            success: false,
            message: '子域名长度不能少于 ' + minLen + ' 个字符'
          },
          400
        )
      }

      const userRecordLimit = resolveUserRecordLimit(userRow, settings.max_records_per_user)
      if (userRecordLimit > 0) {
        const currentCount = await countRecordsByUser(c.env.DB, userId)
        if (currentCount >= userRecordLimit) {
          return c.json(
            {
              success: false,
              message: '已达记录数量上限（' + userRecordLimit + ' 条），无法继续创建'
            },
            403
          )
        }
      }

      const hostName = subdomain + '.' + rootDomain
      const srvName = '_minecraft._tcp.' + hostName

      let row = await findRecordByHostName(c.env.DB, hostName)
      let isNewReservation = false
      if (row) {
        const canResume = row.user_id === userId && row.sync_status !== 'active' &&
          row.pending_server_address === null && row.pending_port === null &&
          row.pending_target_type === null && row.server_address === serverAddress &&
          Number(row.port) === port && row.target_type === targetRecordType
        if (!canResume) {
          return c.json(
            {
              success: false,
              code: 'record_occupied',
              message: '域名 ' + hostName + ' 已被占用，请换一个子域名'
            },
            409
          )
        }
      } else {
        try {
          row = await insertPendingRecord(c.env.DB, {
            user_id: userId,
            root_domain: rootDomain,
            subdomain,
            host_name: hostName,
            server_address: serverAddress,
            port,
            target_type: targetRecordType
          })
          isNewReservation = true
        } catch (error) {
          const concurrent = await findRecordByHostName(c.env.DB, hostName)
          if (concurrent) {
            return c.json({
              success: false,
              code: 'record_occupied',
              message: '域名 ' + hostName + ' 已被占用，请换一个子域名'
            }, 409)
          }
          throw error
        }
      }

      try {
        const zoneId = await fetchZoneId(token, rootDomain)
        const occupiedRecords = await findOccupiedRecords(token, zoneId, [hostName, srvName])
        if (isNewReservation && occupiedRecords.length > 0) {
          await deleteRecordRow(c.env.DB, row.id)
          return c.json({
            success: false,
            code: 'record_occupied',
            message: '域名 ' + hostName + ' 已被占用，请换一个子域名'
          }, 409)
        }

        let targetRecord = remoteRecordByNameAndType(occupiedRecords, hostName, targetRecordType)
        const targetBody = {
          type: targetRecordType,
          name: hostName,
          content: serverAddress,
          ttl: 1 as const,
          proxied: false as const
        }
        if (targetRecord && !isNewReservation) {
          targetRecord = await updateDnsRecord(token, zoneId, targetRecord.id, targetBody)
        } else if (!targetRecord && !isNewReservation && row.target_record_id) {
          try {
            targetRecord = await updateDnsRecord(token, zoneId, row.target_record_id, targetBody)
          } catch (error) {
            if (!isCloudflareDnsError(error) || error.status !== 404) throw error
          }
        }
        if (!targetRecord) {
          targetRecord = await createDnsRecord(token, zoneId, targetBody)
        }
        await persistRecordRemoteIds(c.env.DB, row.id, { target_record_id: targetRecord.id })

        let srvRecord = remoteRecordByNameAndType(occupiedRecords, srvName, 'SRV')
        const srvBody = {
          type: 'SRV' as const,
          name: srvName,
          ttl: 1 as const,
          data: { priority: 0, weight: 5, port, target: hostName }
        }
        if (srvRecord && !isNewReservation) {
          srvRecord = await updateDnsRecord(token, zoneId, srvRecord.id, srvBody)
        } else if (!srvRecord && !isNewReservation && row.srv_record_id) {
          try {
            srvRecord = await updateDnsRecord(token, zoneId, row.srv_record_id, srvBody)
          } catch (error) {
            if (!isCloudflareDnsError(error) || error.status !== 404) throw error
          }
        }
        if (!srvRecord) {
          srvRecord = await createDnsRecord(token, zoneId, srvBody)
        }
        await persistRecordRemoteIds(c.env.DB, row.id, { srv_record_id: srvRecord.id })
        row = (await finalizeRecordSync(c.env.DB, row.id))!

        // Re-check after reservation so concurrent creates cannot exceed the user limit.
        const currentCount = await countRecordsByUser(c.env.DB, userId)
        if (userRecordLimit > 0 && currentCount > userRecordLimit) {
          await deleteRecordAndCloudflare(c.env, row)
          return c.json(
            {
              success: false,
              message: '已达记录数量上限（' + userRecordLimit + ' 条），无法继续创建'
            },
            403
          )
        }

        return c.json({
          success: true,
          message:
            'DNS 记录已创建：' +
            hostName +
            ' -> ' +
            serverAddress +
            '，Minecraft Java 端口 ' +
            port,
          record: row,
          record_count: currentCount,
          record_limit: userRecordLimit,
          records: { target: targetRecord, srv: srvRecord }
        })
      } catch (err) {
        await markRecordSyncError(c.env.DB, row.id, syncErrorCode(err, 'record_create'))
        throw err
      }
    } catch (err) {
      return dnsExternalErrorResponse(c, err, 'record_create')
    }
  })

  app.post('/api/dns/:id/delete', async (c) => {
    try {
      const session = await getCurrentSession(c.env, c.req.raw.headers)
      if (!session) {
        return c.json({ success: false, message: '未登录，请先登录' }, 401)
      }
      const csrfDenied = await requireDnsMutationAuth(c)
      if (csrfDenied) return csrfDenied
      const id = c.req.param('id')
      const record = await findRecordById(c.env.DB, id)
      if (!record) {
        return c.json({ success: false, message: '记录不存在' }, 404)
      }
      if (record.user_id !== session.user.id) {
        return c.json({ success: false, message: '无权删除该记录' }, 403)
      }
      await deleteRecordAndCloudflare(c.env, record)
      const currentCount = await countRecordsByUser(c.env.DB, session.user.id)
      const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
      const userRow = await findUserById(c.env.DB, session.user.id)
      const recordLimit = resolveUserRecordLimit(userRow, settings.max_records_per_user)
      return c.json({
        success: true,
        message: '记录已删除',
        id,
        record_count: currentCount,
        record_limit: recordLimit
      })
    } catch (err) {
      logDnsExternalServiceFailure(toDnsFailureEvent(err, 'record_delete'))
      return c.json({ success: false, message: DNS_GENERIC_SAFE_MESSAGE }, 500)
    }
  })

  app.post('/api/dns/:id/update', async (c) => {
    try {
      const session = await getCurrentSession(c.env, c.req.raw.headers)
      if (!session) {
        return c.json({ success: false, message: '未登录，请先登录' }, 401)
      }
      const csrfDenied = await requireDnsMutationAuth(c)
      if (csrfDenied) return csrfDenied

      const id = c.req.param('id')
      const record = await findRecordById(c.env.DB, id)
      if (!record) {
        return c.json({ success: false, message: '记录不存在' }, 404)
      }
      if (record.user_id !== session.user.id) {
        return c.json({ success: false, message: '无权修改该记录' }, 403)
      }

      const body = await c.req.json()
      const request = parseUpdateDnsRequest(body)
      if (!request.ok) {
        return c.json({ success: false, message: request.message }, 400)
      }

      const { serverAddress, port, targetRecordType } = request.value
      if (targetRecordType === 'CNAME' && serverAddress === record.host_name) {
        return c.json({ success: false, message: '目标域名不能和要创建的域名相同' }, 400)
      }

      if (
        record.sync_status === 'active' &&
        record.server_address === serverAddress &&
        Number(record.port) === port &&
        record.target_type === targetRecordType
      ) {
        return c.json({
          success: true,
          message: '记录未变化',
          record
        })
      }

      const token = getCloudflareApiToken(c.env, record.root_domain)
      if (!token) {
        logDnsExternalServiceFailure({ code: 'DNS_CONFIG_MISSING', stage: 'config' })
        return c.json({ success: false, message: DNS_CONFIG_SAFE_MESSAGE }, 500)
      }

      const hostName = record.host_name
      const srvName = '_minecraft._tcp.' + hostName
      const syncingRecord = await beginRecordUpdate(c.env.DB, record.id, {
        server_address: serverAddress,
        port,
        target_type: targetRecordType
      })
      if (!syncingRecord) {
        return c.json({ success: false, message: '记录不存在' }, 404)
      }

      try {
        const zoneId = await fetchZoneId(token, record.root_domain)
        let occupiedRecords = await findOccupiedRecords(token, zoneId, [hostName, srvName])
        let targetRecord = remoteRecordByNameAndType(occupiedRecords, hostName, targetRecordType)

        if (record.target_type !== targetRecordType && !targetRecord) {
          const oldIds = occupiedRecords
            .filter((item) =>
              item.name.toLowerCase().replace(/\.$/, '') === hostName &&
              ['A', 'AAAA', 'CNAME'].includes(item.type.toUpperCase())
            )
            .map((item) => item.id)
          if (record.target_record_id) oldIds.push(record.target_record_id)
          for (const oldId of [...new Set(oldIds)]) {
            await deleteCloudflareDnsRecord(token, zoneId, oldId)
          }
          await persistRecordRemoteIds(c.env.DB, record.id, { target_record_id: '' })
        }

        if (targetRecord) {
          targetRecord = await updateDnsRecord(token, zoneId, targetRecord.id, {
            type: targetRecordType,
            name: hostName,
            content: serverAddress,
            ttl: 1,
            proxied: false
          })
        } else if (record.target_type === targetRecordType && record.target_record_id) {
          try {
            targetRecord = await updateDnsRecord(token, zoneId, record.target_record_id, {
              type: targetRecordType,
              name: hostName,
              content: serverAddress,
              ttl: 1,
              proxied: false
            })
          } catch (error) {
            if (!isCloudflareDnsError(error) || error.status !== 404) throw error
            targetRecord = await createDnsRecord(token, zoneId, {
              type: targetRecordType,
              name: hostName,
              content: serverAddress,
              ttl: 1,
              proxied: false
            })
          }
        } else {
          targetRecord = await createDnsRecord(token, zoneId, {
            type: targetRecordType,
            name: hostName,
            content: serverAddress,
            ttl: 1,
            proxied: false
          })
        }
        await persistRecordRemoteIds(c.env.DB, record.id, { target_record_id: targetRecord.id })

        occupiedRecords = await findOccupiedRecords(token, zoneId, [srvName])
        let srvRecord = remoteRecordByNameAndType(occupiedRecords, srvName, 'SRV')
        if (srvRecord) {
          srvRecord = await updateDnsRecord(token, zoneId, srvRecord.id, {
            type: 'SRV',
            name: srvName,
            ttl: 1,
            data: { priority: 0, weight: 5, port, target: hostName }
          })
        } else if (record.srv_record_id) {
          try {
            srvRecord = await updateDnsRecord(token, zoneId, record.srv_record_id, {
              type: 'SRV',
              name: srvName,
              ttl: 1,
              data: { priority: 0, weight: 5, port, target: hostName }
            })
          } catch (error) {
            if (!isCloudflareDnsError(error) || error.status !== 404) throw error
            srvRecord = await createDnsRecord(token, zoneId, {
              type: 'SRV',
              name: srvName,
              ttl: 1,
              data: { priority: 0, weight: 5, port, target: hostName }
            })
          }
        } else {
          srvRecord = await createDnsRecord(token, zoneId, {
            type: 'SRV',
            name: srvName,
            ttl: 1,
            data: { priority: 0, weight: 5, port, target: hostName }
          })
        }
        await persistRecordRemoteIds(c.env.DB, record.id, { srv_record_id: srvRecord.id })

        const updated = await finalizeRecordSync(c.env.DB, record.id, {
          server_address: serverAddress,
          port,
          target_type: targetRecordType
        })

        return c.json({
          success: true,
          message: 'DNS 记录已更新：' + hostName + ' -> ' + serverAddress + '，端口 ' + port,
          record: updated
        })
      } catch (err) {
        await markRecordSyncError(c.env.DB, record.id, syncErrorCode(err, 'record_update'))
        throw err
      }
    } catch (err) {
      return dnsExternalErrorResponse(c, err, 'record_update')
    }
  })
}
