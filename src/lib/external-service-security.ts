export type DnsExternalFailureCode =
  | 'DNS_CONFIG_MISSING'
  | 'CLOUDFLARE_REQUEST_FAILED'
  | 'CLOUDFLARE_ZONE_NOT_FOUND'
  | 'DNS_EXTERNAL_FAILURE'

export type DnsExternalFailureStage =
  | 'config'
  | 'zone_lookup'
  | 'record_lookup'
  | 'record_create'
  | 'record_update'
  | 'record_delete'
  | 'cleanup'

export type MailExternalFailureCode =
  | 'MAIL_CONFIG_MISSING'
  | 'MAIL_DISABLED'
  | 'MAIL_INVALID_RECIPIENT'
  | 'RESEND_REQUEST_FAILED'
  | 'MAIL_NETWORK_FAILURE'
  | 'MAIL_ALL_ACCOUNTS_FAILED'

export type MailExternalFailureStage =
  | 'config'
  | 'recipient_validation'
  | 'send'

export const DNS_CONFIG_SAFE_MESSAGE = 'DNS 配置暂不可用，请联系管理员'
export const DNS_EXTERNAL_SAFE_MESSAGE = 'DNS 服务暂时不可用，请稍后重试'
export const DNS_GENERIC_SAFE_MESSAGE = 'DNS 请求处理失败，请稍后重试'
export const MAIL_CONFIG_SAFE_MESSAGE = '邮件配置暂不可用，请检查后台配置'
export const MAIL_SEND_SAFE_MESSAGE = '测试邮件发送失败，请检查邮件配置后重试'
export const MAIL_TEST_SUCCESS_MESSAGE = '测试邮件已提交发送'

export type DnsExternalFailureEventInput = {
  code: DnsExternalFailureCode
  stage: DnsExternalFailureStage
  status?: number
  retriable?: boolean
}

export type MailExternalFailureEventInput = {
  code: MailExternalFailureCode
  stage: MailExternalFailureStage
  status?: number
  accountIndex?: number
  retriable?: boolean
}

function finiteStatus(status: number | undefined): number | undefined {
  return Number.isFinite(status) ? Math.trunc(status as number) : undefined
}

export function createDnsExternalServiceSecurityEvent(input: DnsExternalFailureEventInput) {
  return {
    event: 'dns_external_service_failed',
    code: input.code,
    stage: input.stage,
    service: 'cloudflare_dns',
    status: finiteStatus(input.status),
    retriable: !!input.retriable,
    timestamp: Date.now()
  }
}

export function createMailExternalServiceSecurityEvent(input: MailExternalFailureEventInput) {
  return {
    event: 'mail_external_service_failed',
    code: input.code,
    stage: input.stage,
    service: 'resend',
    status: finiteStatus(input.status),
    account_index: Number.isFinite(input.accountIndex) ? Math.trunc(input.accountIndex as number) : undefined,
    retriable: !!input.retriable,
    timestamp: Date.now()
  }
}

export function logDnsExternalServiceFailure(input: DnsExternalFailureEventInput): void {
  console.error(JSON.stringify(createDnsExternalServiceSecurityEvent(input)))
}

export function logMailExternalServiceFailure(input: MailExternalFailureEventInput): void {
  console.error(JSON.stringify(createMailExternalServiceSecurityEvent(input)))
}

export function safeDnsClientMessage(code: DnsExternalFailureCode): string {
  return code === 'DNS_CONFIG_MISSING'
    ? DNS_CONFIG_SAFE_MESSAGE
    : DNS_EXTERNAL_SAFE_MESSAGE
}

export function safeMailTestClientMessage(code: MailExternalFailureCode): string {
  if (code === 'MAIL_CONFIG_MISSING' || code === 'MAIL_DISABLED') {
    return MAIL_CONFIG_SAFE_MESSAGE
  }
  return MAIL_SEND_SAFE_MESSAGE
}
