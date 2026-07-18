import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('production migration execution', () => {
  it('keeps trigger bodies multiline for the remote D1 SQL parser', async () => {
    const sql = await readFile('migrations/0012_dns_sync_state.sql', 'utf8')

    expect(sql).not.toMatch(/\bBEGIN[^\r\n]+;\s*END;/i)
    expect(sql.match(/CREATE TRIGGER/gi)).toHaveLength(2)
  })

  it('uses the lockfile-pinned Wrangler for remote migrations', async () => {
    const workflow = await readFile('.github/workflows/deploy.yml', 'utf8')

    expect(workflow).toContain(
      'pnpm exec wrangler d1 migrations apply mc-server-hide-port-tool-db --remote'
    )
    expect(workflow).not.toContain(
      'npx wrangler d1 migrations apply mc-server-hide-port-tool-db --remote'
    )
    expect(workflow).toContain('name: Apply remote D1 migrations')
    expect(workflow).not.toContain('preCommands:')
  })

  it('uses the Node 24 Wrangler Action release', async () => {
    const workflow = await readFile('.github/workflows/deploy.yml', 'utf8')

    expect(workflow).toContain(
      'cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0 # v4'
    )
  })
})
