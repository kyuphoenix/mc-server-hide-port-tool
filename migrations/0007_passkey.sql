-- Migration: 0007_passkey
-- better-auth @better-auth/passkey plugin storage (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS "passkey" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL DEFAULT 0,
  "transports" TEXT,
  "createdAt" INTEGER,
  "aaguid" TEXT,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey"("userId");
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx" ON "passkey"("credentialID");
