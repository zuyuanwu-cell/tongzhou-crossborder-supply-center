ALTER TABLE partner_ai_transcriptions
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS request_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  ADD COLUMN IF NOT EXISTS cleanup_error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS next_cleanup_at timestamptz;

ALTER TABLE partner_ai_drafts
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS request_hash text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_ai_transcriptions_idempotency
  ON partner_ai_transcriptions(organization_id,user_id,idempotency_key)
  WHERE idempotency_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_ai_drafts_idempotency
  ON partner_ai_drafts(organization_id,user_id,idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_partner_ai_transcriptions_cleanup_retry
  ON partner_ai_transcriptions(next_cleanup_at,expires_at)
  WHERE deleted_at IS NULL;

