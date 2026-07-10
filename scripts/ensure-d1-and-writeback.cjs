#!/usr/bin/env node
/**
 * 幂等确保 Cloudflare D1 数据库 mc-server-hide-port-tool-db 存在，并把其 uuid 写回 wrangler.jsonc
 * 的 d1_databases[0].database_id。
 *
 * 通过 Cloudflare REST API 实现，避免依赖 wrangler d1 create（已存在时会报错阻塞）。
 *
 * 环境变量：
 *   CLOUDFLARE_API_TOKEN  - 部署用 API Token（需 D1:Edit 权限）
 *   CLOUDFLARE_ACCOUNT_ID - 账户 ID
 */
const fs = require('fs');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_NAME = 'mc-server-hide-port-tool-db';
const CONFIG_PATH = 'wrangler.jsonc';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID 未设置');
  process.exit(1);
}

function api(path, init) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database${path}`;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...init,
  }).then((r) => r.json());
}

function readJsonc(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const stripped = raw
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

(async () => {
  // 1) 查现有数据库
  const list = await api('');
  if (!list.success) {
    console.error('D1 list 调用失败:', JSON.stringify(list.errors));
    process.exit(1);
  }

  let db = (list.result || []).find((d) => d.name === DB_NAME);

  if (!db) {
    console.log(`数据库 ${DB_NAME} 不存在，开始创建…`);
    const created = await api('', {
      method: 'POST',
      body: JSON.stringify({ name: DB_NAME }),
    });
    if (!created.success) {
      console.error('D1 创建失败:', JSON.stringify(created.errors));
      process.exit(1);
    }
    db = created.result;
    console.log(`数据库已创建，uuid = ${db.uuid}`);
  } else {
    console.log(`数据库已存在，uuid = ${db.uuid}`);
  }

  // 2) 写回 wrangler.jsonc
  const cfg = readJsonc(CONFIG_PATH);
  if (!Array.isArray(cfg.d1_databases) || cfg.d1_databases.length === 0) {
    console.error('wrangler.jsonc 缺少 d1_databases 配置');
    process.exit(1);
  }
  cfg.d1_databases[0].database_id = db.uuid;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`已更新 ${CONFIG_PATH}: d1_databases[0].database_id = ${db.uuid}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
