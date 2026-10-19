ALTER TABLE warehouse_inventory_projections
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qualification_coverage jsonb;

ALTER TABLE warehouse_inventory_projections
  DROP CONSTRAINT IF EXISTS warehouse_inventory_projections_qualification_coverage_object;

ALTER TABLE warehouse_inventory_projections
  ADD CONSTRAINT warehouse_inventory_projections_qualification_coverage_object
  CHECK (qualification_coverage IS NULL OR jsonb_typeof(qualification_coverage) = 'object');

CREATE TABLE IF NOT EXISTS warehouse_inventory_projection_states (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_ref text NOT NULL,
  warehouse_name text NOT NULL,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  qualification_item_count integer NOT NULL DEFAULT 0 CHECK (qualification_item_count >= 0),
  last_core_synced_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (organization_id, warehouse_ref)
);

ALTER TABLE warehouse_inventory_projection_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_inventory_projection_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON warehouse_inventory_projection_states;
CREATE POLICY tenant_isolation ON warehouse_inventory_projection_states
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);
