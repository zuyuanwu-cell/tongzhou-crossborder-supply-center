ALTER TABLE warehouse_inventory_projections
  ADD COLUMN IF NOT EXISTS barcode text NOT NULL DEFAULT '';

ALTER TABLE warehouse_inventory_projections
  DROP CONSTRAINT IF EXISTS warehouse_inventory_projections_barcode_length;

ALTER TABLE warehouse_inventory_projections
  ADD CONSTRAINT warehouse_inventory_projections_barcode_length
  CHECK (char_length(barcode) <= 160);

CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_org_warehouse_barcode
  ON warehouse_inventory_projections(organization_id, warehouse_ref, barcode)
  WHERE barcode <> '';
