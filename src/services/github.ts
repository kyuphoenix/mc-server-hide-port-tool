export async function getGitHubUser(accessToken: string): Promise<{
  id: number
  login: string
  email: string | null
  created_at: string
} | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hide-port-tool'
    }
  })
  if (!res.ok) return null
  return await res.json()
}

export function meetsAgeRequirement(createdAt: string, minDays: number): boolean {
  if (!minDays || minDays <= 0) return true
  const createdMs = Date.parse(createdAt)
  if (Number.isNaN(createdMs)) return false
  const ageDays = (Date.now() - createdMs) / 86400000
  return ageDays >= minDays
}
