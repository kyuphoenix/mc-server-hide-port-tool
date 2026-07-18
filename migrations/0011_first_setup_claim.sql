-- Migration: 0011_first_setup_claim
-- Atomic first-administrator claim state and credential completion.

CREATE TABLE "first_setup" (
  "id" INTEGER PRIMARY KEY NOT NULL CHECK ("id" = 1),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'claimed', 'completed')),
  "claim_token_hash" TEXT,
  "claimed_at" INTEGER,
  "claimed_user_id" TEXT,
  "completed_at" INTEGER,
  CHECK (
    ("status" = 'open'
      AND "claim_token_hash" IS NULL
      AND "claimed_at" IS NULL
      AND "claimed_user_id" IS NULL
      AND "completed_at" IS NULL)
    OR
    ("status" = 'claimed'
      AND "claim_token_hash" IS NOT NULL
      AND "claimed_at" IS NOT NULL
      AND "completed_at" IS NULL)
    OR
    ("status" = 'completed'
      AND "claim_token_hash" IS NULL
      AND "completed_at" IS NOT NULL)
  )
);

INSERT INTO "first_setup"
  ("id", "status", "claim_token_hash", "claimed_at", "claimed_user_id", "completed_at")
SELECT
  1,
  CASE WHEN EXISTS (SELECT 1 FROM "user") THEN 'completed' ELSE 'open' END,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN EXISTS (SELECT 1 FROM "user")
    THEN CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    ELSE NULL
  END;
