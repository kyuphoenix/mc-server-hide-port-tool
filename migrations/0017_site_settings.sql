-- Migration: 0017_site_settings
-- deployment: backward-compatible
-- Store homepage display settings and the global normal DNS mode switch.

ALTER TABLE "settings" ADD COLUMN "site_page_title" TEXT NOT NULL DEFAULT '子域名分发系统';
ALTER TABLE "settings" ADD COLUMN "site_header_name" TEXT NOT NULL DEFAULT '子域名分发系统';
ALTER TABLE "settings" ADD COLUMN "dns_mode_enabled" INTEGER NOT NULL DEFAULT 1;
