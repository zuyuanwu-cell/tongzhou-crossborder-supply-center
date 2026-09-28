ALTER TABLE collaboration_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
