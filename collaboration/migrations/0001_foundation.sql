CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name text NOT NULL,
  organization_type text NOT NULL CHECK (organization_type IN (
    'internal', 'warehouse', 'filing_service', 'sampling_factory',
    'packaging_factory', 'production_factory'
  )),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collaboration_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  email text,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'locked', 'disabled')),
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  totp_secret_ciphertext text,
  totp_enabled_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_users_username_lower ON collaboration_users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_users_email_lower ON collaboration_users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES collaboration_users(id),
  role text NOT NULL CHECK (role IN ('organization_admin', 'manager', 'operator', 'finance', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  mfa_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id, status);

CREATE TABLE IF NOT EXISTS collaboration_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text,
  username text NOT NULL,
  role text NOT NULL CHECK (role IN ('organization_admin', 'manager', 'operator', 'finance', 'viewer')),
  mfa_required boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by uuid REFERENCES collaboration_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collaboration_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES collaboration_users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON collaboration_password_resets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  csrf_token_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES collaboration_users(id),
  membership_id uuid NOT NULL REFERENCES organization_memberships(id),
  ip_address inet,
  user_agent text,
  mfa_verified_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_token ON collaboration_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_user ON collaboration_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS collaboration_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  core_ref_type text NOT NULL,
  core_ref_id text NOT NULL,
  project_type text NOT NULL CHECK (project_type IN ('warehouse', 'oem')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  public_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, core_ref_type, core_ref_id)
);

CREATE TABLE IF NOT EXISTS collaboration_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES collaboration_projects(id) ON DELETE CASCADE,
  space_type text NOT NULL CHECK (space_type IN (
    'warehouse', 'filing', 'sampling', 'packaging_quote', 'production'
  )),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id, space_type)
);

CREATE TABLE IF NOT EXISTS work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  core_ref_type text NOT NULL,
  core_ref_id text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN (
    'warehouse_inbound', 'warehouse_outbound', 'warehouse_transfer', 'warehouse_stockup',
    'warehouse_exception', 'filing_task', 'sampling_task', 'packaging_quote', 'production_order'
  )),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'in_progress', 'pending_approval', 'pending_sync',
    'completed', 'rejected', 'cancelled'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_member_id uuid REFERENCES organization_memberships(id),
  due_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_core_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, core_ref_type, core_ref_id)
);
CREATE INDEX IF NOT EXISTS idx_work_items_org_status ON work_items(organization_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_work_items_space ON work_items(space_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS warehouse_task_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_name text NOT NULL,
  image_url text,
  planned_quantity numeric(16,4) NOT NULL CHECK (planned_quantity >= 0),
  completed_quantity numeric(16,4) NOT NULL DEFAULT 0 CHECK (completed_quantity >= 0),
  unit text NOT NULL DEFAULT '件',
  lot_no text,
  barcode text,
  production_date date,
  expiry_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warehouse_task_lines_item ON warehouse_task_lines(work_item_id, sku);

CREATE TABLE IF NOT EXISTS warehouse_inventory_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_ref text NOT NULL,
  warehouse_name text NOT NULL,
  sku text NOT NULL,
  product_name text NOT NULL,
  available_quantity numeric(16,4) NOT NULL DEFAULT 0,
  locked_quantity numeric(16,4) NOT NULL DEFAULT 0,
  in_transit_quantity numeric(16,4) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '件',
  last_core_synced_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, warehouse_ref, sku)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_org_sku ON warehouse_inventory_projections(organization_id, sku);

CREATE TABLE IF NOT EXISTS work_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES collaboration_users(id),
  actor_name text NOT NULL,
  body text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_item_events_item ON work_item_events(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  status text NOT NULL CHECK (status IN ('pending_sync', 'pending_approval', 'processing', 'applied', 'rejected', 'failed')),
  submitted_by uuid NOT NULL REFERENCES collaboration_users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result_code text,
  result_message text,
  core_reference text,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_partner_commands_status ON partner_commands(status, submitted_at);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  command_id uuid NOT NULL UNIQUE REFERENCES partner_commands(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 52428800),
  sha256 text,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'rejected', 'failed')),
  uploaded_by uuid NOT NULL REFERENCES collaboration_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES collaboration_users(id),
  work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'wecom')),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed', 'read')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(organization_id, user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid REFERENCES collaboration_users(id),
  actor_name text NOT NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  result text NOT NULL,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_time ON audit_log(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'applied', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_integration_outbox_pending ON integration_outbox(status, next_attempt_at);

-- OEM tables are provisioned now but remain inaccessible while the feature gate is disabled.
CREATE TABLE IF NOT EXISTS oem_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('filing_document', 'sample_result', 'design_file', 'quality_report')),
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by uuid REFERENCES collaboration_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  currency text NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount >= 0),
  minimum_order_quantity numeric(16,4) NOT NULL DEFAULT 0,
  lead_time_days integer NOT NULL DEFAULT 0,
  terms text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'awarded', 'declined', 'expired')),
  version integer NOT NULL DEFAULT 1,
  submitted_by uuid NOT NULL REFERENCES collaboration_users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, work_item_id, version)
);

CREATE TABLE IF NOT EXISTS production_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  milestone_type text NOT NULL,
  title text NOT NULL,
  planned_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, work_item_id, milestone_type)
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'collaboration_users', 'organization_memberships',
    'collaboration_projects', 'collaboration_spaces', 'work_items',
    'warehouse_task_lines', 'oem_artifacts', 'production_milestones'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
  END LOOP;
END;
$$;

-- Database-enforced tenant isolation. The portal must set app.current_organization_id
-- inside every transaction. The integration connection uses a separate BYPASSRLS role.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organization_memberships', 'collaboration_invitations',
    'collaboration_projects', 'collaboration_spaces', 'work_items', 'warehouse_task_lines',
    'warehouse_inventory_projections', 'work_item_events', 'partner_commands', 'approvals',
    'attachments', 'notifications', 'audit_log', 'oem_artifacts', 'supplier_quotes',
    'production_milestones'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE collaboration_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON collaboration_users;
CREATE POLICY tenant_isolation ON collaboration_users
  USING (EXISTS (
    SELECT 1 FROM organization_memberships membership
    WHERE membership.user_id = collaboration_users.id
      AND membership.organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  ));

ALTER TABLE collaboration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON collaboration_sessions;
CREATE POLICY tenant_isolation ON collaboration_sessions
  USING (EXISTS (
    SELECT 1 FROM organization_memberships membership
    WHERE membership.id = collaboration_sessions.membership_id
      AND membership.organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM organization_memberships membership
    WHERE membership.id = collaboration_sessions.membership_id
      AND membership.organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  ));

-- Audit rows are append-only for the portal role. UPDATE/DELETE are intentionally blocked in the API.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
