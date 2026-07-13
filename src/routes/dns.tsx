import type { Hono } from 'hono'
import { getCurrentSession } from '../auth'
import { getSettings } from '../services/settings'
import {
  countRecordsByUser,
  findRecordByHostName,
  findRecordById,
  findUserById,
  insertRecord,
  resolveMinSubdomainLength,
  resolveUserRecordLimit
} from '../services/dns-records'
import {
  createDnsRecord,
  deleteRecordAndCloudflare,
  fetchZoneId,
  findOccupiedRecords,
  getAllowedDomains,
  getCloudflareApiToken,
  parseCreateDnsRequest,
  type Bindings
} from '../services/cloudflare-dns'

export function registerDnsRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.get('/api/domains', async (c) => {
    const domains = getAllowedDomains(c.env)
    const settings = await getSettings(c.env.DB)
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
      const userId = session.user.id
      const userRow = await findUserById(c.env.DB, userId)

      const body = await c.req.json()
      const domains = getAllowedDomains(c.env)

      if (domains.length === 0) {
        return c.json({ success: false, message: '后端未配置可用根域名 DOMAINS' }, 500)
      }

      const request = parseCreateDnsRequest(body, domains)
      if (!request.ok) {
        return c.json({ success: false, message: request.message }, 400)
      }

      const { subdomain, rootDomain, serverAddress, port, targetRecordType } = request.value
      const token = getCloudflareApiToken(c.env, rootDomain)
      if (!token) {
        return c.json(
          {
            success: false,
            message: '后端未配置根域名 ' + rootDomain + ' 对应的 CLOUDFLARE_API_TOKEN'
          },
          500
        )
      }

      const settings = await getSettings(c.env.DB)
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

      const existing = await findRecordByHostName(c.env.DB, hostName)
      if (existing) {
        return c.json(
          {
            success: false,
            code: 'record_occupied',
            message: '域名 ' + hostName + ' 已被占用，请换一个子域名'
          },
          409
        )
      }

      const zoneId = await fetchZoneId(token, rootDomain)
      const occupiedRecords = await findOccupiedRecords(token, zoneId, [hostName, srvName])
      if (occupiedRecords.length > 0) {
        return c.json(
          {
            success: false,
            code: 'record_occupied',
            message: '域名 ' + hostName + ' 已被占用，请换一个子域名'
          },
          409
        )
      }

      const targetRecord = await createDnsRecord(token, zoneId, {
        type: targetRecordType,
        name: hostName,
        content: serverAddress,
        ttl: 1,
        proxied: false
      })

      const srvRecord = await createDnsRecord(token, zoneId, {
        type: 'SRV',
        name: srvName,
        ttl: 1,
        data: { priority: 0, weight: 5, port, target: hostName }
      })

      const row = await insertRecord(c.env.DB, {
        user_id: userId,
        root_domain: rootDomain,
        subdomain,
        host_name: hostName,
        server_address: serverAddress,
        port,
        target_type: targetRecordType,
        target_record_id: targetRecord.id,
        srv_record_id: srvRecord.id
      })

      const currentCount = await countRecordsByUser(c.env.DB, userId)

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
      const message = err instanceof Error ? err.message : '请求处理失败'
      return c.json({ success: false, message }, 500)
    }
  })

  app.post('/api/dns/:id/delete', async (c) => {
    const session = await getCurrentSession(c.env, c.req.raw.headers)
    if (!session) {
      return c.json({ success: false, message: '未登录，请先登录' }, 401)
    }
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
    const settings = await getSettings(c.env.DB)
    const userRow = await findUserById(c.env.DB, session.user.id)
    const recordLimit = resolveUserRecordLimit(userRow, settings.max_records_per_user)
    return c.json({
      success: true,
      message: '记录已删除',
      id,
      record_count: currentCount,
      record_limit: recordLimit
    })
  })

  // 兼容旧表单提交
  app.post('/dns/:id/delete', async (c) => {
    const session = await getCurrentSession(c.env, c.req.raw.headers)
    if (!session) return c.redirect('/login')
    const id = c.req.param('id')
    const record = await findRecordById(c.env.DB, id)
    if (!record) return c.redirect('/')
    if (record.user_id !== session.user.id) return c.redirect('/')
    await deleteRecordAndCloudflare(c.env, record)
    return c.redirect('/')
  })
}
