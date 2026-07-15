-- Migration: 0010_oauth_registration_intents
ALTER TABLE "invite_code" ADD COLUMN "reserved_intent_id" TEXT;
ALTER TABLE "invite_code" ADD COLUMN "reserved_at" INTEGER;
CREATE INDEX IF NOT EXISTS "invite_code_reserved_intent_id_index"
  ON "invite_code"("reserved_intent_id");
CREATE INDEX IF NOT EXISTS "invite_code_reserved_at_index"
  ON "invite_code"("reserved_at");

CREATE TABLE IF NOT EXISTS "oauth_registration_intent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "provider_id" TEXT NOT NULL,
  "oauth_state_hash" TEXT,
  "invite_code_id" TEXT,
  "created_at" INTEGER NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "authorized_at" INTEGER,
  "authorized_user_id" TEXT,
  "consumed_at" INTEGER,
  FOREIGN KEY ("invite_code_id") REFERENCES "invite_code"("id")
    ON UPDATE NO ACTION ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS "oauth_registration_intent_expires_at_index"
  ON "oauth_registration_intent"("expires_at");
CREATE INDEX IF NOT EXISTS "oauth_registration_intent_oauth_state_hash_index"
  ON "oauth_registration_intent"("oauth_state_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_registration_intent_authorized_user_id_unique"
  ON "oauth_registration_intent"("authorized_user_id")
  WHERE "authorized_user_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "oauth_registration_intent_consumed_at_index"
  ON "oauth_registration_intent"("consumed_at");

CREATE TRIGGER IF NOT EXISTS "oauth_registration_intent_consume_invite"
BEFORE UPDATE OF "consumed_at" ON "oauth_registration_intent"
WHEN OLD."consumed_at" IS NULL AND NEW."consumed_at" IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW."authorized_at" IS NULL OR NEW."authorized_user_id" IS NULL
      THEN RAISE(ABORT, 'oauth_intent_not_authorized')
    WHEN NEW."invite_code_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "invite_code"
      WHERE "id" = NEW."invite_code_id"
        AND "used_by" IS NULL
        AND "revoked" = 0
        AND "reserved_intent_id" = NEW."id"
    ) THEN RAISE(ABORT, 'oauth_invite_reservation_invalid')
  END;
  UPDATE "invite_code"
  SET "used_by" = NEW."authorized_user_id",
      "used_at" = NEW."consumed_at",
      "reserved_intent_id" = NULL,
      "reserved_at" = NULL
  WHERE "id" = NEW."invite_code_id"
    AND "used_by" IS NULL
    AND "revoked" = 0
    AND "reserved_intent_id" = NEW."id";
END;

CREATE TRIGGER IF NOT EXISTS "oauth_registration_intent_release_pending_invite"
AFTER DELETE ON "oauth_registration_intent"
WHEN OLD."authorized_at" IS NULL AND OLD."invite_code_id" IS NOT NULL
BEGIN
  UPDATE "invite_code"
  SET "reserved_intent_id" = NULL, "reserved_at" = NULL
  WHERE "id" = OLD."invite_code_id"
    AND "used_by" IS NULL
    AND "reserved_intent_id" = OLD."id";
END;
