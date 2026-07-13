#!/usr/bin/env python3
"""
解析 CLOUDFLARE_DOMAINS_API_TOKEN（格式  domain1:token1,domain2:token2,...），
为每个域名生成 wrangler secret 名（域名小写、点换下划线）+ 对应 token 值。

用法：
  python scripts/parse_domain_tokens.py <CLOUDFLARE_DOMAINS_API_TOKEN>
输出（stdout）：
    line 1: 逗号分隔的 wrangler secret 名列表（已配置的非空 token）
    line 2: JSON 对象，键=wrangler secret 名，值=token
    line 3: JSON 数组字符串，从 CLOUDFLARE_DOMAINS_API_TOKEN 解析出的域名列表
            （可直接覆盖到 worker 的 DOMAINS 变量）
"""
from __future__ import annotations
import json
import sys


def secret_name_for(domain: str) -> str:
    return domain.strip().lower().replace(".", "_") + "_CLOUDFLARE_API_TOKEN"


def parse_pairs(raw: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if not raw or not raw.strip():
        return pairs
    for item in raw.split(","):
        item = item.strip()
        if not item or ":" not in item:
            continue
        domain, token = item.split(":", 1)
        domain = domain.strip().lower()
        token = token.strip()
        if domain and token:
            pairs.append((domain, token))
    return pairs


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: parse_domain_tokens.py <CLOUDFLARE_DOMAINS_API_TOKEN>", file=sys.stderr)
        return 2

    pairs = parse_pairs(sys.argv[1])
    seen: dict[str, str] = {}
    for d, t in pairs:
        seen.setdefault(d, t)

    secret_map: dict[str, str] = {}
    for d, t in seen.items():
        secret_map[secret_name_for(d)] = t

    print(",".join(sorted(secret_map.keys())))
    print(json.dumps(secret_map, ensure_ascii=False, sort_keys=True))
    print(json.dumps(list(seen.keys()), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
