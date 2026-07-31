-- Migration: 0015_dns_record_modes
-- deployment: backward-compatible
-- Extend DNS records from Minecraft-only SRV helpers to general DNS distribution.

ALTER TABLE "dns_record" ADD COLUMN "record_mode" TEXT NOT NULL DEFAULT 'mc';
ALTER TABLE "dns_record" ADD COLUMN "proxied" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "dns_record" ADD COLUMN "pending_record_mode" TEXT;
ALTER TABLE "dns_record" ADD COLUMN "pending_proxied" INTEGER;

CREATE INDEX IF NOT EXISTS "dns_record_mode_index"
  ON "dns_record"("record_mode");
