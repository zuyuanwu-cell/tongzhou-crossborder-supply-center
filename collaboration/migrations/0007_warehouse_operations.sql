ALTER TABLE warehouse_inventory_projections
  ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';

ALTER TABLE warehouse_inventory_projections
  DROP CONSTRAINT IF EXISTS warehouse_inventory_projections_image_url_length;

ALTER TABLE warehouse_inventory_projections
  ADD CONSTRAINT warehouse_inventory_projections_image_url_length
  CHECK (length(image_url) <= 2000);
