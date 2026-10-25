CREATE TABLE IF NOT EXISTS partner_ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES collaboration_users(id),
  scenario text NOT NULL DEFAULT 'production_progress' CHECK (scenario IN ('production_progress')),
  state text NOT NULL DEFAULT 'identifying_order' CHECK (state IN ('identifying_order','confirming_order','collecting_progress','review','submitted','expired')),
  confirmed_work_item_id uuid REFERENCES work_items(id),
  confirmed_work_item_version integer CHECK (confirmed_work_item_version IS NULL OR confirmed_work_item_version > 0),
  candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  source_text text NOT NULL DEFAULT '',
  collected_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_question text NOT NULL DEFAULT '',
  latest_transcription_id uuid REFERENCES partner_ai_transcriptions(id),
  latest_draft_id uuid REFERENCES partner_ai_drafts(id),
  submitted_command_id uuid REFERENCES partner_commands(id),
  submitted_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_modified boolean,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  completed_at timestamptz,
  content_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((confirmed_work_item_id IS NULL AND confirmed_work_item_version IS NULL) OR
         (confirmed_work_item_id IS NOT NULL AND confirmed_work_item_version IS NOT NULL))
);

ALTER TABLE partner_ai_transcriptions
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES partner_ai_sessions(id);

ALTER TABLE partner_ai_drafts
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES partner_ai_sessions(id);

ALTER TABLE partner_ai_transcriptions ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE partner_ai_transcriptions ALTER COLUMN work_item_version DROP NOT NULL;

ALTER TABLE partner_ai_transcriptions DROP CONSTRAINT IF EXISTS partner_ai_transcriptions_scope_check;
ALTER TABLE partner_ai_transcriptions ADD CONSTRAINT partner_ai_transcriptions_scope_check CHECK (
  (session_id IS NULL AND work_item_id IS NOT NULL AND work_item_version IS NOT NULL) OR
  (session_id IS NOT NULL AND work_item_id IS NULL AND work_item_version IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_partner_ai_sessions_owner
  ON partner_ai_sessions(organization_id,user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_ai_sessions_active
  ON partner_ai_sessions(organization_id,user_id,expires_at)
  WHERE state NOT IN ('submitted','expired');
CREATE INDEX IF NOT EXISTS idx_partner_ai_transcriptions_session
  ON partner_ai_transcriptions(organization_id,user_id,session_id,created_at DESC)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_ai_drafts_session
  ON partner_ai_drafts(organization_id,user_id,session_id,created_at DESC)
  WHERE session_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_partner_ai_sessions_updated_at ON partner_ai_sessions;
CREATE TRIGGER trg_partner_ai_sessions_updated_at BEFORE UPDATE ON partner_ai_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE partner_ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_ai_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON partner_ai_sessions;
CREATE POLICY tenant_isolation ON partner_ai_sessions
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);
