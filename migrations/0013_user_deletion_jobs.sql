-- Migration: 0013_user_deletion_jobs
-- deployment: backward-compatible
-- Persist bounded, resumable user deletion work across Worker invocations.

CREATE TABLE IF NOT EXISTS "user_deletion_job" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL UNIQUE,
  "created_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'running', 'failed', 'completed')),
  "processed_records" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "lease_token" TEXT,
  "lease_expires_at" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "completed_at" INTEGER
);

CREATE INDEX IF NOT EXISTS "user_deletion_job_status_updated_index"
  ON "user_deletion_job"("status", "updated_at");
