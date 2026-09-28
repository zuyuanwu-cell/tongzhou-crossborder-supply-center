CREATE TABLE IF NOT EXISTS organization_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  resource_type text NOT NULL CHECK (resource_type IN ('warehouse', 'organization')),
  resource_ref text NOT NULL CHECK (length(btrim(resource_ref)) BETWEEN 1 AND 160),
  resource_name text NOT NULL DEFAULT '',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array'),
  created_by_name text NOT NULL DEFAULT '系统迁移',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, resource_type, resource_ref)
);

CREATE INDEX IF NOT EXISTS idx_organization_access_grants_scope
  ON organization_access_grants(organization_id, resource_type, resource_ref);

DROP TRIGGER IF EXISTS trg_organization_access_grants_updated_at ON organization_access_grants;
CREATE TRIGGER trg_organization_access_grants_updated_at
  BEFORE UPDATE ON organization_access_grants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Preserve existing warehouse collaboration by deriving the exact warehouses that
-- already have inventory or task projections. New organizations remain deny-by-default.
WITH existing_warehouses AS (
  SELECT organization_id, warehouse_ref, max(warehouse_name) AS warehouse_name
    FROM warehouse_inventory_projections
   WHERE warehouse_ref <> ''
   GROUP BY organization_id, warehouse_ref
  UNION
  SELECT organization_id,
         public_payload->>'warehouseRef' AS warehouse_ref,
         max(public_payload->>'warehouseName') AS warehouse_name
    FROM work_items
   WHERE item_type LIKE 'warehouse_%'
     AND coalesce(public_payload->>'warehouseRef', '') <> ''
   GROUP BY organization_id, public_payload->>'warehouseRef'
)
INSERT INTO organization_access_grants(
  organization_id, resource_type, resource_ref, resource_name, permissions, created_by_name
)
SELECT organization_id, 'warehouse', warehouse_ref, coalesce(warehouse_name, warehouse_ref),
       '["warehouse.inventory.view","warehouse.task.view","warehouse.task.handle","warehouse.exception.report","warehouse.inbound.confirm","warehouse.outbound.confirm","warehouse.transfer.receive","warehouse.inventory.adjust.request","warehouse.task.complete","attachment.upload"]'::jsonb,
       '系统迁移'
  FROM existing_warehouses
ON CONFLICT (organization_id, resource_type, resource_ref) DO NOTHING;

-- Existing OEM organizations receive only the capability set matching their type.
INSERT INTO organization_access_grants(
  organization_id, resource_type, resource_ref, resource_name, permissions, created_by_name
)
SELECT id, 'organization',
       CASE organization_type
         WHEN 'filing_service' THEN 'filing'
         WHEN 'sampling_factory' THEN 'sampling'
         WHEN 'packaging_factory' THEN 'packaging_quote'
         WHEN 'production_factory' THEN 'production'
       END,
       name,
       CASE organization_type
         WHEN 'filing_service' THEN '["filing.task.view","filing.task.handle","filing.artifact.submit","attachment.upload"]'::jsonb
         WHEN 'sampling_factory' THEN '["sampling.task.view","sampling.task.handle","sampling.artifact.submit","attachment.upload"]'::jsonb
         WHEN 'packaging_factory' THEN '["packaging.quote.view","packaging.quote.submit","attachment.upload"]'::jsonb
         WHEN 'production_factory' THEN '["production.order.view","production.progress.update","production.artifact.submit","attachment.upload"]'::jsonb
       END,
       '系统迁移'
  FROM organizations
 WHERE organization_type IN ('filing_service','sampling_factory','packaging_factory','production_factory')
ON CONFLICT (organization_id, resource_type, resource_ref) DO NOTHING;

INSERT INTO organization_access_grants(
  organization_id, resource_type, resource_ref, resource_name, permissions, created_by_name
)
SELECT id, 'organization', 'sampling', name,
       '["sampling.task.view","sampling.task.handle","sampling.artifact.submit","attachment.upload"]'::jsonb,
       '系统迁移'
  FROM organizations
 WHERE organization_type = 'production_factory'
ON CONFLICT (organization_id, resource_type, resource_ref) DO NOTHING;

ALTER TABLE organization_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_access_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organization_access_grants;
CREATE POLICY tenant_isolation ON organization_access_grants
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid);
