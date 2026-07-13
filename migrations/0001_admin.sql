-- Migration: 0001_admin
-- 添加管理员后台所需字段与表

-- 给 better-auth 的 user 表加 role 列（默认普通用户）
ALTER TABLE "user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- DNS 记录归属表（user_id = NULL 表示管理员/系统创建）
CREATE TABLE IF NOT EXISTS "dns_record" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT,
  "root_domain" TEXT NOT NULL,
  "subdomain" TEXT NOT NULL,
  "host_name" TEXT NOT NULL,
  "server_address" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_record_id" TEXT NOT NULL,
  "srv_record_id" TEXT,
  "created_at" INTEGER NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE NO ACTION ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "dns_record_user_id_index" ON "dns_record"("user_id");
CREATE INDEX IF NOT EXISTS "dns_record_host_name_index" ON "dns_record"("host_name");

-- 全局设置表（固定单行，id='default'）
CREATE TABLE IF NOT EXISTS "settings" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
  "registration_enabled" INTEGER NOT NULL DEFAULT 1,
  "registration_mode" TEXT NOT NULL DEFAULT 'email', -- email | oauth | both
  "email_whitelist_enabled" INTEGER NOT NULL DEFAULT 0,
  "email_whitelist_suffixes" TEXT NOT NULL DEFAULT '[]',
  "email_blacklist_enabled" INTEGER NOT NULL DEFAULT 0,
  "email_blacklist_suffixes" TEXT NOT NULL DEFAULT '[]',
  "github_min_account_age_days" INTEGER NOT NULL DEFAULT 0,
  "resend_enabled" INTEGER NOT NULL DEFAULT 0,
  "resend_api_key" TEXT,
  "resend_from" TEXT
);

-- 邮箱验证码暂存表
CREATE TABLE IF NOT EXISTS "email_verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_verification_email_index" ON "email_verification"("email");

-- 初始化默认设置行
INSERT INTO "settings" ("id") VALUES ('default')
  ON CONFLICT("id") DO NOTHING;
