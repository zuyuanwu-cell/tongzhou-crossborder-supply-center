ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_organization_type_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_organization_type_check CHECK (organization_type IN (
  'internal', 'warehouse', 'filing_service', 'sampling_factory',
  'packaging_factory', 'production_factory', 'material_supplier'
));

ALTER TABLE collaboration_projects DROP CONSTRAINT IF EXISTS collaboration_projects_project_type_check;
ALTER TABLE collaboration_projects ADD CONSTRAINT collaboration_projects_project_type_check
  CHECK (project_type IN ('warehouse', 'oem', 'procurement'));

ALTER TABLE collaboration_spaces DROP CONSTRAINT IF EXISTS collaboration_spaces_space_type_check;
ALTER TABLE collaboration_spaces ADD CONSTRAINT collaboration_spaces_space_type_check CHECK (space_type IN (
  'warehouse', 'filing', 'sampling', 'packaging_quote', 'production', 'procurement'
));

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_item_type_check;
ALTER TABLE work_items ADD CONSTRAINT work_items_item_type_check CHECK (item_type IN (
  'warehouse_inbound', 'warehouse_outbound', 'warehouse_transfer', 'warehouse_stockup',
  'warehouse_exception', 'filing_task', 'sampling_task', 'packaging_quote',
  'production_order', 'purchase_order'
));

CREATE TABLE IF NOT EXISTS partner_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  line_ref text NOT NULL,
  line_type text NOT NULL CHECK (line_type IN ('finished_product', 'raw_material', 'packaging')),
  sku text NOT NULL,
  product_name text NOT NULL,
  specification text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  planned_quantity numeric(16,4) NOT NULL CHECK (planned_quantity >= 0),
  completed_quantity numeric(16,4) NOT NULL DEFAULT 0 CHECK (completed_quantity >= 0),
  unit text NOT NULL DEFAULT '件',
  required_at date,
  responsibility text NOT NULL DEFAULT 'supplier' CHECK (responsibility IN ('tongzhou', 'factory', 'supplier')),
  unit_price numeric(18,4) CHECK (unit_price IS NULL OR unit_price >= 0),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency ~ '^[A-Z]{3}$'),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, work_item_id, line_ref)
);
CREATE INDEX IF NOT EXISTS idx_partner_order_lines_item ON partner_order_lines(work_item_id, active, line_type, created_at);

CREATE TABLE IF NOT EXISTS partner_order_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  line_id uuid REFERENCES partner_order_lines(id),
  command_id uuid NOT NULL UNIQUE REFERENCES partner_commands(id),
  report_type text NOT NULL CHECK (report_type IN (
    'production_progress', 'material_readiness', 'purchase_fulfillment', 'exception', 'shipment'
  )),
  stage text NOT NULL DEFAULT '',
  progress_percent integer CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  result text NOT NULL DEFAULT '',
  quantity numeric(16,4) CHECK (quantity IS NULL OR quantity >= 0),
  expected_at timestamptz,
  severity text NOT NULL DEFAULT '' CHECK (severity IN ('', 'notice', 'warning', 'critical')),
  title text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by uuid NOT NULL REFERENCES collaboration_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_order_reports_item ON partner_order_reports(work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_order_reports_line ON partner_order_reports(line_id, created_at DESC) WHERE line_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_partner_order_lines_updated_at ON partner_order_lines;
CREATE TRIGGER trg_partner_order_lines_updated_at
  BEFORE UPDATE ON partner_order_lines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE partner_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON partner_order_lines;
CREATE POLICY tenant_isolation ON partner_order_lines
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE partner_order_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_order_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON partner_order_reports;
CREATE POLICY tenant_isolation ON partner_order_reports
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);

REVOKE UPDATE, DELETE ON partner_order_reports FROM PUBLIC;
