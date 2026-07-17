#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const migrationsDir = path.join(process.cwd(), 'migrations')
const enforcementStartsAt = '0012'
const marker = '-- deployment: backward-compatible'
const forbidden = [
  { pattern: /\bDROP\s+(?:TABLE|INDEX|TRIGGER|VIEW|COLUMN)\b/i, reason: 'DROP statements can break the currently deployed Worker' },
  { pattern: /\bALTER\s+TABLE\b[\s\S]*?\b(?:DROP|RENAME)\b/i, reason: 'destructive ALTER TABLE requires a staged deployment' },
  { pattern: /\bPRAGMA\s+(?:writable_schema|legacy_alter_table)\b/i, reason: 'schema rewriting pragmas require a staged deployment' },
  { pattern: /\bVACUUM\b/i, reason: 'VACUUM must not run in the deployment migration path' }
]

function withoutComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
}

const files = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name.slice(0, 4) >= enforcementStartsAt)
  .sort()

const errors = []
for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  if (!sql.toLowerCase().includes(marker)) {
    errors.push(`${file}: missing "${marker}" declaration`)
  }
  const executable = withoutComments(sql)
  for (const rule of forbidden) {
    if (rule.pattern.test(executable)) errors.push(`${file}: ${rule.reason}`)
  }
  for (const statement of executable.split(';')) {
    if (/\bALTER\s+TABLE\b/i.test(statement) && !/\bALTER\s+TABLE\s+(?:"[^"]+"|\S+)\s+ADD\s+COLUMN\b/i.test(statement)) {
      errors.push(`${file}: only ADD COLUMN is allowed in an in-place production ALTER TABLE`)
    }
  }
}

if (errors.length) {
  console.error('Production migration compatibility validation failed:')
  for (const error of errors) console.error(`- ${error}`)
  console.error('Use an expand/deploy/backfill/contract rollout for destructive schema changes.')
  process.exit(1)
}

console.log(`Validated ${files.length} backward-compatible production migration(s).`)
