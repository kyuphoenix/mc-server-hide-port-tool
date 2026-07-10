#!/usr/bin/env python3
"""
把 GitHub 仓库 secrets 中按 .dev.vars.example 同名（全大写）存放的变量，转换为 wrangler 所需的两个列表：
- secret_keys  : 需要 `wrangler secret put` 的敏感键（API token / auth secret / github secret 等）
- var_keys      : 可作为普通 plaintext vars 写入 wrangler.jsonc 的键（DOMAINS / BETTER_AUTH_URL 等）

敏感键判定规则：key 名称中包含以下子串之一即视为 secret：
    CLOUDFLARE_API_TOKEN, BETTER_AUTH_SECRET, GITHUB_CLIENT_SECRET, GITHUB_CLIENT_ID
（GITHUB_CLIENT_ID 也走 secret，避免明文 OAuth 配置外泄）

输入：stdout 依次打印：
  line 1: 逗号分隔的 secret_keys
  line 2: 逗号分隔的 var_keys
后续步骤直接 parse stdout 即可。

GitHub Actions 调用约定：
  每个 .dev.vars.example 中的键 K，仓库里直接存同名 secret 与 env 变量。
  注意 GitHub Actions secret / env 名必须仅含 [A-Z0-9_]，故把原键名全大写化后使用：
  例：example1_com_CLOUDFLARE_API_TOKEN  ->  EXAMPLE1_COM_CLOUDFLARE_API_TOKEN
      DOMAINS                            ->  DOMAINS
      BETTER_AUTH_URL                    ->  BETTER_AUTH_URL
"""
from __future__ import annotations
import json
import os
import re
import sys
from pathlib import Path

SENSITIVE_PATTERNS = (
    "CLOUDFLARE_API_TOKEN",
    "BETTER_AUTH_SECRET",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
)


def secret_name_for(key: str) -> str:
    """把 .dev.vars.example 中的键名映射为 GitHub Actions secret / env 名（仅 [A-Z0-9_]）。"""
    return re.sub(r"[^A-Z0-9_]", "_", key.upper())


def is_sensitive(key: str) -> bool:
    k = key.upper()
    return any(p in k for p in SENSITIVE_PATTERNS)


def main() -> int:
    example = Path(__file__).resolve().parent.parent / ".dev.vars.example"
    if not example.exists():
        print(f"missing {example}", file=sys.stderr)
        return 1

    secret_keys: list[str] = []
    var_keys: list[str] = []
    missing: list[str] = []

    for line in example.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if not key:
            continue
        gh_name = secret_name_for(key)
        if gh_name not in os.environ:
            # GitHub Actions 不会把未设置的 secret 注入 env；这里仅记录以便统一警告。
            missing.append(f"{key} (env {gh_name})")
        if is_sensitive(key):
            secret_keys.append(key)
        else:
            var_keys.append(key)

    if missing:
        # 非致命：有些变量（如 GitHub OAuth）可能未配置
        print(f"[warn] 未在环境中找到的变量：\n  - " + "\n  - ".join(missing), file=sys.stderr)

    print(",".join(secret_keys))
    print(",".join(var_keys))
    return 0


if __name__ == "__main__":
    sys.exit(main())
