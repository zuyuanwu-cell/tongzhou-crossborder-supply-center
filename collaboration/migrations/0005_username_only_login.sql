CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_memberships_user_unique
  ON organization_memberships(user_id);
