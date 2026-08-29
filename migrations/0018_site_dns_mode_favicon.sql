-- Migration: 0018_site_dns_mode_favicon
-- deployment: backward-compatible
-- Site DNS mode selector ('mc' | 'dns' | 'both') and favicon settings.
-- site_dns_mode: NULL means derive from legacy dns_mode_enabled column.
-- favicon_url: public URL to the site icon (empty = none).
-- favicon_data: data URL (data:image/...;base64,...) of an uploaded icon (empty = none).

ALTER TABLE "settings" ADD COLUMN "site_dns_mode" TEXT;
ALTER TABLE "settings" ADD COLUMN "favicon_url" TEXT NOT NULL DEFAULT '';
ALTER TABLE "settings" ADD COLUMN "favicon_data" TEXT NOT NULL DEFAULT '';