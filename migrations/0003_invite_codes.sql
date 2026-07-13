-- Migration: 0003_invite_codes
-- 邀请码注册：全局开关 + 邀请码表 + 邮箱验证暂存字段

ALTER TABLE "settings" ADD COLUMN "invite_required" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "email_verification" ADD COLUMN "invite_code" TEXT;

CREATE TABLE IF NOT EXISTS "invite_code" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "code" TEXT NOT NULL UNIQUE,
  "created_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "used_by" TEXT,
  "used_at" INTEGER,
  "revoked" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY ("created_by") REFERENCES "user"("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY ("used_by") REFERENCES "user"("id") ON UPDATE NO ACTION ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "invite_code_code_index" ON "invite_code"("code");
CREATE INDEX IF NOT EXISTS "invite_code_created_by_index" ON "invite_code"("created_by");
CREATE INDEX IF NOT EXISTS "invite_code_used_by_index" ON "invite_code"("used_by");
