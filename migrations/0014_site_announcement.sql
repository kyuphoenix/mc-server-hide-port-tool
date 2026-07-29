-- Migration: 0014_site_announcement
-- deployment: backward-compatible
-- Store one administrator-managed, versioned site announcement.

CREATE TABLE IF NOT EXISTS "site_announcement" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL DEFAULT '系统公告',
  "content" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "updated_by" TEXT
);

INSERT INTO "site_announcement" ("id") VALUES ('default')
  ON CONFLICT("id") DO NOTHING;
