#!/usr/bin/env node
/**
 * 把 BETTER_AUTH_URL 中的主机名作为 custom domain 写入 wrangler.jsonc 的 routes 数组，
 * 让 `wrangler deploy` 自动创建/绑定 custom domain（含 DNS 与证书）。
 *
 * 跳过条件：
 *   - BETTER_AUTH_URL 未设置或为空
 *   - 解析出的主机名为 *.workers.dev
 *
 * 环境变量：
 *   BETTER_AUTH_URL - 该 worker 的对外访问 URL（含协议），如 https://mc.example.com
 */
const fs = require('fs');

const CONFIG_PATH = 'wrangler.jsonc';
const AUTH_URL = process.env.BETTER_AUTH_URL || '';

function readJsonc(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const stripped = raw
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

function parseHostname(input) {
  let u = (input || '').trim();
  if (!u) return '';
  if (!/^[a-zA-Z]+:\/\//.test(u)) u = 'https://' + u;
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const hostname = parseHostname(AUTH_URL);

if (!hostname) {
  console.log('BETTER_AUTH_URL 未设置或无法解析主机名，跳过 custom domain patch。');
  process.exit(0);
}

if (hostname.endsWith('.workers.dev')) {
  console.log(`主机名 ${hostname} 是 workers.dev 子域，无需 custom domain，跳过。`);
  process.exit(0);
}

const cfg = readJsonc(CONFIG_PATH);
cfg.routes = Array.isArray(cfg.routes) ? cfg.routes : [];

const exists = cfg.routes.some(
  (r) => r && r.pattern === hostname && r.custom_domain === true
);

if (exists) {
  console.log(`routes 中已存在 custom domain ${hostname}，无需重复添加。`);
  process.exit(0);
}

cfg.routes.push({ pattern: hostname, custom_domain: true });
fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
console.log(`已写入 wrangler.jsonc routes: { pattern: "${hostname}", custom_domain: true }`);
