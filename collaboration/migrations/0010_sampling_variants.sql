ALTER TABLE supplier_quotes
  ADD COLUMN IF NOT EXISTS sample_variant_code text NOT NULL DEFAULT '';

COMMENT ON COLUMN supplier_quotes.sample_variant_code IS 'System-generated approved sample variant code permanently bound to the quote';
