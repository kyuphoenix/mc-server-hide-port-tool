import { getSettings } from './settings'

export async function sendVerificationCode(
  env: { DB: D1Database },
  toEmail: string,
  code: string
): Promise<{ ok: boolean; message?: string }> {
  const settings = await getSettings(env.DB)

  if (!settings.resend_enabled || !settings.resend_api_key || !settings.resend_from) {
    return { ok: false, message: '后端未配置 Resend，无法发送邮件' }
  }

  const subject = '注册邮箱验证码'
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
  <h2>Minecraft 端口隐藏工具</h2>
  <p>您的注册验证码是：</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:4px;padding:12px 16px;background:#f4f4f4;border-radius:6px;text-align:center;">${code}</p>
  <p>验证码 10 分钟内有效，请勿向他人泄露。</p>
</div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.resend_api_key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: settings.resend_from,
      to: [toEmail],
      subject,
      html
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, message: `Resend API 错误：${res.status} ${text.slice(0, 200)}` }
  }

  return { ok: true }
}
