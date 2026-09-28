#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${COLLABORATION_INTEGRATION_DB_PASSWORD:?COLLABORATION_INTEGRATION_DB_PASSWORD is required}"
: "${COLLABORATION_PORTAL_DB_PASSWORD:?COLLABORATION_PORTAL_DB_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=integration_password="$COLLABORATION_INTEGRATION_DB_PASSWORD" \
  --set=portal_password="$COLLABORATION_PORTAL_DB_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

SELECT format(
  'CREATE ROLE tongzhou_integration LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
  :'integration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tongzhou_integration')
\gexec

SELECT format(
  'CREATE ROLE tongzhou_portal LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'portal_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tongzhou_portal')
\gexec

ALTER DATABASE tongzhou_collaboration OWNER TO tongzhou_integration;
GRANT CONNECT ON DATABASE tongzhou_collaboration TO tongzhou_portal;
SQL
