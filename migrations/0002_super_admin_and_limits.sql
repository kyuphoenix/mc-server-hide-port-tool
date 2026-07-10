-- Migration: 0002_super_admin_and_limits
-- 超级管理员 + 记录上限 + 子域名最小长度

-- user 表：标记超级管理员 + 单用户记录上限（NULL 表示使用全局上限）
ALTER TABLE "user" ADD COLUMN "super_admin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "record_limit" INTEGER;

-- settings 表：全局记录上限 + 子域名最小字符长度
ALTER TABLE "settings" ADD COLUMN "max_records_per_user" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "settings" ADD COLUMN "min_subdomain_length" INTEGER NOT NULL DEFAULT 0;
