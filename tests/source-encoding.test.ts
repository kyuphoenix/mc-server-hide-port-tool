import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { DEFAULT_SETTINGS, isEmailAllowed } from '../src/services/settings'

const runtimeExtensions = new Set(['.ts', '.tsx', '.js', '.css'])

function collectRuntimeFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectRuntimeFiles(path))
    else if (runtimeExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

describe('source text encoding', () => {
  it('keeps production source and hardening documents free of known corruption markers', () => {
    const files = [
      ...collectRuntimeFiles(join(process.cwd(), 'src')),
      ...collectRuntimeFiles(join(process.cwd(), 'public')),
      join(process.cwd(), 'docs/superpowers/plans/2026-07-16-production-hardening-plan.md'),
      join(process.cwd(), 'docs/superpowers/specs/2026-07-16-production-hardening-design.md')
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
