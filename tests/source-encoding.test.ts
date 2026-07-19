import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { DEFAULT_SETTINGS, isEmailAllowed } from '../src/services/settings'

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.css'])
const documentationExtensions = new Set(['.md'])

function collectTextFiles(directory: string, extensions: ReadonlySet<string>): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectTextFiles(path, extensions))
    else if (extensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

describe('source text encoding', () => {
  it('keeps production source and hardening documents free of known corruption markers', () => {
    const files = [
      ...collectTextFiles(join(process.cwd(), 'src'), sourceExtensions),
      ...collectTextFiles(join(process.cwd(), 'public'), sourceExtensions),
      ...collectTextFiles(join(process.cwd(), 'docs'), documentationExtensions)
    ]

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain('\uFFFD')
      expect(source, file).not.toMatch(/\?{3,}/)
      expect(source, file).not.toMatch(/鏃犳|涓嶈|鐢ㄦ|瓒呯骇|澶勭悊|宸插/)
    }
  })

  it('returns readable email policy errors', () => {
    expect(isEmailAllowed('invalid', DEFAULT_SETTINGS)).toEqual({
      ok: false,
      reason: '邮箱格式无效'
    })
    expect(isEmailAllowed('user@blocked.example', {
      ...DEFAULT_SETTINGS,
      email_blacklist_enabled: true,
      email_blacklist_suffixes: ['blocked.example']
    })).toEqual({
      ok: false,
      reason: '邮箱域名不允许注册'
    })
  })
})
