-- Sampling collaboration: bind every sample round and quote to the exact work item/version.
ALTER TABLE oem_artifacts
  ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE;

UPDATE oem_artifacts artifact
   SET work_item_id = command.work_item_id
  FROM partner_commands command
 WHERE artifact.work_item_id IS NULL
   AND command.organization_id = artifact.organization_id
   AND command.command_type = 'artifact_submit'
   AND command.payload->>'artifactId' = artifact.id::text;

-- Only use the legacy space relation when it identifies exactly one task. Ambiguous
-- historical rows remain unbound instead of risking cross-task data mixing.
UPDATE oem_artifacts artifact
   SET work_item_id = (
    SELECT work_item.id
      FROM work_items work_item
     WHERE work_item.organization_id = artifact.organization_id
       AND work_item.space_id = artifact.space_id
     LIMIT 1
  )
 WHERE artifact.work_item_id IS NULL
   AND 1 = (
     SELECT count(*)
       FROM work_items work_item
      WHERE work_item.organization_id = artifact.organization_id
        AND work_item.space_id = artifact.space_id
   );

CREATE INDEX IF NOT EXISTS idx_oem_artifacts_work_item
  ON oem_artifacts(organization_id, work_item_id, artifact_type, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_sample_round_version
  ON oem_artifacts(organization_id, work_item_id, version)
  WHERE artifact_type = 'sample_result' AND work_item_id IS NOT NULL;

ALTER TABLE supplier_quotes
  ADD COLUMN IF NOT EXISTS sample_artifact_id uuid REFERENCES oem_artifacts(id),
  ADD COLUMN IF NOT EXISTS sample_version integer;

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_sample_artifact
  ON supplier_quotes(organization_id, sample_artifact_id)
  WHERE sample_artifact_id IS NOT NULL;

-- Existing sampling grants should immediately receive the new post-approval quote capability.
UPDATE organization_access_grants
   SET permissions = permissions || '["sampling.quote.submit"]'::jsonb,
       updated_at = now()
 WHERE resource_type = 'organization'
   AND resource_ref = 'sampling'
   AND permissions ? 'sampling.artifact.submit'
   AND NOT permissions ? 'sampling.quote.submit';
