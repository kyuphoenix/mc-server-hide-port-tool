-- Migration: 0004_oauth_providers
-- 通用 OAuth 提供商配置（由管理后台维护，运行时注入 better-auth genericOAuth）

CREATE TABLE IF NOT EXISTS "oauth_provider" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "provider_id" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "client_secret" TEXT NOT NULL,
  "discovery_url" TEXT,
  "authorization_url" TEXT,
  "token_url" TEXT,
  "user_info_url" TEXT,
  "scopes" TEXT NOT NULL DEFAULT 'openid,profile,email',
  "pkce" INTEGER NOT NULL DEFAULT 1,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "oauth_provider_enabled_index" ON "oauth_provider"("enabled");
CREATE INDEX IF NOT EXISTS "oauth_provider_sort_order_index" ON "oauth_provider"("sort_order");
