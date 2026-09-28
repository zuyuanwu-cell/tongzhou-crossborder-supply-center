CREATE ROLE tongzhou_portal LOGIN PASSWORD 'local-portal-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE tongzhou_collaboration TO tongzhou_portal;
GRANT USAGE ON SCHEMA public TO tongzhou_portal;

-- Migrations run as tongzhou_integration, so future portal-facing tables inherit these grants.
ALTER DEFAULT PRIVILEGES FOR ROLE tongzhou_integration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tongzhou_portal;
ALTER DEFAULT PRIVILEGES FOR ROLE tongzhou_integration IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tongzhou_portal;
