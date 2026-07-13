-- Migration: 0009_rate_limit_and_passkey_unique
-- Persist email verification rate-limit buckets across Workers isolates.
-- Also enforce unique passkey credential IDs.

CREATE TABLE IF NOT EXISTS "rate_limit_bucket" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "reset_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "rate_limit_bucket_reset_at_index"
  ON "rate_limit_bucket"("reset_at");

-- Passkey credential IDs must be unique.
DROP INDEX IF EXISTS "passkey_credentialID_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credentialID_unique"
  ON "passkey"("credentialID");
