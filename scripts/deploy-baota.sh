#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${DEPLOY_PROJECT_DIR:-/www/wwwroot/gyl.tongzhoukuajing.com}"
BACKUP_BASE="${DEPLOY_BACKUP_BASE:-/www/backup/tongzhou-supply}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8787/api/health}"
PM2_APP="${DEPLOY_PM2_APP:-tongzhou-supply-api}"

if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  echo "[deploy] project git directory not found: $PROJECT_DIR" >&2
  exit 20
fi

cd "$PROJECT_DIR"

if [[ -z "${DEPLOY_TARGET_COMMIT:-}" ]]; then
  git fetch origin main
  DEPLOY_TARGET_COMMIT="$(git rev-parse origin/main)"
fi

if ! git cat-file -e "${DEPLOY_TARGET_COMMIT}^{commit}" 2>/dev/null; then
  echo "[deploy] target commit is unavailable: $DEPLOY_TARGET_COMMIT" >&2
  exit 21
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_BASE/$STAMP"
mkdir -p "$BACKUP_DIR"

echo "__PRECHECK__"
git status --short
git rev-parse HEAD | tee "$BACKUP_DIR/before-commit.txt"
printf '%s\n' "$DEPLOY_TARGET_COMMIT" > "$BACKUP_DIR/target-commit.txt"
df -h "$PROJECT_DIR"

echo "__BACKUP__ $BACKUP_DIR"
tar \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./.git' \
  -czf "$BACKUP_DIR/project-before.tgz" .
test -s "$BACKUP_DIR/project-before.tgz"

echo "__UPDATE__"
git merge --ff-only "$DEPLOY_TARGET_COMMIT"
ACTUAL_COMMIT="$(git rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$DEPLOY_TARGET_COMMIT" ]]; then
  echo "[deploy] expected $DEPLOY_TARGET_COMMIT, got $ACTUAL_COMMIT" >&2
  exit 31
fi

echo "__INSTALL_BUILD__"
npm ci
npm run build
test -s dist/index.html

echo "__RESTART__"
pm2 restart "$PM2_APP" --update-env
pm2 save

echo "__HEALTH__"
attempt=0
until curl -fsS "$HEALTH_URL"; do
  attempt=$((attempt + 1))
  if (( attempt >= 10 )); then
    echo "[deploy] health check failed after $attempt attempts" >&2
    pm2 logs "$PM2_APP" --lines 80 --nostream || true
    exit 41
  fi
  sleep 2
done
echo

pm2 pid "$PM2_APP"
printf 'commit=%s\nbackup=%s\ncompleted_at=%s\n' \
  "$ACTUAL_COMMIT" \
  "$BACKUP_DIR" \
  "$(date -Iseconds)" | tee "$BACKUP_BASE/latest-success.txt"
echo "__DEPLOY_SUCCESS__"
