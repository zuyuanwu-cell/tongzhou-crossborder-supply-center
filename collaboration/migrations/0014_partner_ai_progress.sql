CREATE TABLE IF NOT EXISTS partner_ai_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  user_id uuid NOT NULL REFERENCES collaboration_users(id),
  work_item_version integer NOT NULL CHECK (work_item_version > 0),
  object_key text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2621440),
  duration_ms integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 50000),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','uploaded','processing','completed','failed','deleted')),
  transcript text NOT NULL DEFAULT '',
  asr_request_id text NOT NULL DEFAULT '',
  error_code text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  completed_at timestamptz,
  deleted_at timestamptz,
  transcript_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_ai_transcriptions_owner ON partner_ai_transcriptions(organization_id,user_id,work_item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_ai_transcriptions_cleanup ON partner_ai_transcriptions(status,expires_at);

CREATE TABLE IF NOT EXISTS partner_ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  user_id uuid NOT NULL REFERENCES collaboration_users(id),
  transcription_id uuid REFERENCES partner_ai_transcriptions(id),
  work_item_version integer NOT NULL CHECK (work_item_version > 0),
  draft_type text NOT NULL CHECK (draft_type IN ('production_progress','purchase_fulfillment','work_item_progress')),
  source_type text NOT NULL CHECK (source_type IN ('text','voice')),
  source_text text NOT NULL,
  draft_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  prompt_version text NOT NULL DEFAULT 'partner-progress-v1',
  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','generated','applied','submitted','expired','failed')),
  applied_at timestamptz,
  submitted_command_id uuid REFERENCES partner_commands(id),
  content_purged_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_ai_drafts_owner ON partner_ai_drafts(organization_id,user_id,work_item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_ai_drafts_retention ON partner_ai_drafts(created_at,status);

CREATE TABLE IF NOT EXISTS partner_ai_settings (
  singleton_key text PRIMARY KEY CHECK (singleton_key = 'global'),
  encrypted_config text NOT NULL,
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_partner_ai_transcriptions_updated_at ON partner_ai_transcriptions;
CREATE TRIGGER trg_partner_ai_transcriptions_updated_at BEFORE UPDATE ON partner_ai_transcriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_partner_ai_drafts_updated_at ON partner_ai_drafts;
CREATE TRIGGER trg_partner_ai_drafts_updated_at BEFORE UPDATE ON partner_ai_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_partner_ai_settings_updated_at ON partner_ai_settings;
CREATE TRIGGER trg_partner_ai_settings_updated_at BEFORE UPDATE ON partner_ai_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE partner_ai_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_ai_transcriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON partner_ai_transcriptions;
CREATE POLICY tenant_isolation ON partner_ai_transcriptions
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE partner_ai_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_ai_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON partner_ai_drafts;
CREATE POLICY tenant_isolation ON partner_ai_drafts
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);
