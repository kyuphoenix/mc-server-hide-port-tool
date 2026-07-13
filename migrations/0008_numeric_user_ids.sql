-- Migration: 0008_numeric_user_ids
-- Counter for sequential numeric user ids ("1","2","3"...).

CREATE TABLE IF NOT EXISTS "user_id_counter" (
  "name" TEXT PRIMARY KEY NOT NULL,
  "value" INTEGER NOT NULL
);

INSERT INTO "user_id_counter" ("name", "value")
VALUES ('user', 0)
ON CONFLICT("name") DO NOTHING;
