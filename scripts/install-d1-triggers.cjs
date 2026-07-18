#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const database = 'mc-server-hide-port-tool-db'
const target = process.argv[2]
if (target !== '--local' && target !== '--remote') {
  console.error('Usage: node scripts/install-d1-triggers.cjs --local|--remote')
  process.exit(1)
}

const triggersDir = path.join(process.cwd(), 'migrations', 'triggers')
const files = fs.readdirSync(triggersDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()

const wrangler = path.join(path.dirname(require.resolve('wrangler')), '..', 'bin', 'wrangler.js')
for (const file of files) {
  const sql = fs.readFileSync(path.join(triggersDir, file), 'utf8').trim()
  if (!/^CREATE TRIGGER IF NOT EXISTS\b/i.test(sql) || /[\r\n]/.test(sql)) {
    console.error(`${file}: trigger SQL must be one line and idempotent`)
    process.exit(1)
  }

  console.log(`Installing D1 trigger: ${file}`)
  const args = [
    wrangler, 'd1', 'execute', database,
    target, '--yes', '--command', sql
  ]
  if (target === '--local' && process.env.D1_PERSIST_TO) {
    args.push('--persist-to', process.env.D1_PERSIST_TO)
  }
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`Installed ${files.length} D1 trigger(s).`)
