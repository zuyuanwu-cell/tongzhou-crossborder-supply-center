-- WeChat mini program quick login: one WeChat identity per account per mini program.
-- Only keyed hashes of openid/unionid are stored, never the raw ids or the WeChat session_key.
CREATE TABLE IF NOT EXISTS collaboration_wechat_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES collaboration_users(id) ON DELETE CASCADE,
  app_id text NOT NULL CHECK (length(app_id) BETWEEN 4 AND 64),
  openid_hash text NOT NULL CHECK (openid_hash ~ '^[0-9a-f]{64}$'),
  unionid_hash text CHECK (unionid_hash IS NULL OR unionid_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (app_id, openid_hash),
  UNIQUE (user_id, app_id)
);

-- System-only table: the portal role gets no grants and RLS has no permissive policy.
ALTER TABLE collaboration_wechat_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_wechat_bindings FORCE ROW LEVEL SECURITY;
