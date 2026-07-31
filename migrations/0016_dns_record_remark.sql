-- Migration: 0016_dns_record_remark
-- deployment: backward-compatible
-- Store optional user-facing notes for DNS records and pending updates.

ALTER TABLE "dns_record" ADD COLUMN "remark" TEXT NOT NULL DEFAULT '';
ALTER TABLE "dns_record" ADD COLUMN "pending_remark" TEXT;
