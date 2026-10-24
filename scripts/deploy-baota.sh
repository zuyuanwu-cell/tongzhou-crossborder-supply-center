#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="${DEPLOY_PROJECT_DIR:-/www/wwwroot/gyl.tongzhoukuajing.com}"
BACKUP_BASE="${DEPLOY_BACKUP_BASE:-/www/backup/tongzhou-supply}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8787/api/health}"
EXTERNAL_URL="${DEPLOY_EXTERNAL_URL:-https://gyl.tongzhoukuajing.com}"
HEALTH_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-90}"
HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-2}"
PM2_APP="${DEPLOY_PM2_APP:-tongzhou-supply-api}"
PM2_RESTORE_APP="${DEPLOY_PM2_RESTORE_APP:-tongzhou-system-restore}"
DEPLOY_COMPONENT="${DEPLOY_COMPONENT:-auto}"
UI_SMOKE_COMMAND="${DEPLOY_UI_SMOKE_COMMAND:-}"
FRONTEND_CONTRACT="${DEPLOY_FRONTEND_CONTRACT:-config/production-ui-contract.json}"

if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  echo "[deploy] project git directory not found: $PROJECT_DIR" >&2
  exit 20
fi

if ! [[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || ! [[ "$HEALTH_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "[deploy] health attempts and interval must be positive integers" >&2
  exit 27
fi

cd "$PROJECT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[deploy] refused: production has tracked source changes; reconcile them into Git first" >&2
  git status --short >&2
  exit 22
fi

UNTRACKED_RELEASE_FILES="$(git ls-files --others --exclude-standard -- \
  'src/**' 'server/**' 'scripts/**' 'collaboration/**' 'config/**' 'public/**' \
  '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' 'package.json' 'package-lock.json' \
  | grep -Ev '^(\.codex-builds/|\.codex-rollbacks/|\.release-[^/]+/|dist([.-][^/]+)?/)' || true)"
if [[ -n "$UNTRACKED_RELEASE_FILES" ]]; then
  echo "[deploy] refused: production has untracked release source files" >&2
  printf '%s\n' "$UNTRACKED_RELEASE_FILES" >&2
  exit 23
fi

BEFORE_COMMIT="$(git rev-parse HEAD)"
if [[ -z "${DEPLOY_TARGET_COMMIT:-}" ]]; then
  git fetch origin main
  DEPLOY_TARGET_COMMIT="$(git rev-parse FETCH_HEAD)"
fi

if ! git cat-file -e "${DEPLOY_TARGET_COMMIT}^{commit}" 2>/dev/null; then
  echo "[deploy] target commit is unavailable: $DEPLOY_TARGET_COMMIT" >&2
  exit 21
fi

FRONTEND_PATHS=(
  'src/**'
  'public/**'
  'index.html'
  'vite.config.ts'
  'tsconfig.json'
  'tsconfig.node.json'
  'package.json'
  'package-lock.json'
)
FRONTEND_DIFF="$(git diff --name-only "$BEFORE_COMMIT" "$DEPLOY_TARGET_COMMIT" -- "${FRONTEND_PATHS[@]}")"
BUILD_FRONTEND=0
case "$DEPLOY_COMPONENT" in
  auto)
    [[ -n "$FRONTEND_DIFF" ]] && BUILD_FRONTEND=1
    ;;
  backend)
    if [[ -n "$FRONTEND_DIFF" ]]; then
      echo "[deploy] refused: backend-only release contains frontend changes:" >&2
      printf '%s\n' "$FRONTEND_DIFF" >&2
      exit 24
    fi
    ;;
  frontend|full)
    BUILD_FRONTEND=1
    ;;
  *)
    echo "[deploy] DEPLOY_COMPONENT must be auto, backend, frontend, or full" >&2
    exit 25
    ;;
esac

if (( BUILD_FRONTEND )) && [[ -z "$UI_SMOKE_COMMAND" ]]; then
  echo "[deploy] refused: frontend release requires DEPLOY_UI_SMOKE_COMMAND" >&2
  echo "[deploy] the command must authenticate and verify the protected workbench and product-library views" >&2
  exit 26
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_BASE/$STAMP"
STAGING_DIR="$PROJECT_DIR/.release-staging-$STAMP"
ROLLBACK_DIST="$PROJECT_DIR/.dist-rollback-$STAMP"
PINNED_GUARD_DIR="$BACKUP_DIR/release-guard"
FRONTEND_SWITCHED=0
mkdir -p "$BACKUP_DIR"

rollback_frontend() {
  if (( FRONTEND_SWITCHED )) && [[ -d "$ROLLBACK_DIST" ]]; then
    echo "[deploy] restoring previous frontend after failed release" >&2
    if [[ -d "$PROJECT_DIR/dist" ]]; then
      mv -- "$PROJECT_DIR/dist" "$BACKUP_DIR/dist-failed"
    fi
    mv -- "$ROLLBACK_DIST" "$PROJECT_DIR/dist"
    FRONTEND_SWITCHED=0
  fi
}

cleanup_staging() {
  if [[ -d "$STAGING_DIR" ]]; then
    if rmdir -- "$STAGING_DIR" 2>/dev/null; then return; fi
    mv -- "$STAGING_DIR" "$BACKUP_DIR/staging-unused"
  fi
}

on_error() {
  local exit_code=$?
  rollback_frontend
  cleanup_staging
  exit "$exit_code"
}
trap on_error ERR INT TERM

echo "__PRECHECK__"
printf 'before_commit=%s\ntarget_commit=%s\ncomponent=%s\nfrontend_build=%s\n' \
  "$BEFORE_COMMIT" "$DEPLOY_TARGET_COMMIT" "$DEPLOY_COMPONENT" "$BUILD_FRONTEND"
df -h "$PROJECT_DIR"

echo "__BACKUP__ $BACKUP_DIR"
printf '%s\n' "$BEFORE_COMMIT" > "$BACKUP_DIR/before-commit.txt"
printf '%s\n' "$DEPLOY_TARGET_COMMIT" > "$BACKUP_DIR/target-commit.txt"
mkdir -p "$PINNED_GUARD_DIR"
install -m 0644 "$PROJECT_DIR/scripts/verify-frontend-release.mjs" "$PINNED_GUARD_DIR/verify-frontend-release.mjs"
install -m 0644 "$PROJECT_DIR/$FRONTEND_CONTRACT" "$PINNED_GUARD_DIR/production-ui-contract.json"
tar \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./dist-*' \
  --exclude='./dist.*' \
  --exclude='./.git' \
  --exclude='./.cache' \
  --exclude='./.codex-builds' \
  --exclude='./.codex-rollbacks' \
  --exclude='./*.bundle' \
  --exclude='./.release-staging-*' \
  --exclude='./.dist-rollback-*' \
  --exclude='./.release-*' \
  -czf "$BACKUP_DIR/project-before.tgz" .
test -s "$BACKUP_DIR/project-before.tgz"

echo "__UPDATE__"
git merge --ff-only "$DEPLOY_TARGET_COMMIT"
ACTUAL_COMMIT="$(git rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$DEPLOY_TARGET_COMMIT" ]]; then
  echo "[deploy] expected $DEPLOY_TARGET_COMMIT, got $ACTUAL_COMMIT" >&2
  exit 31
fi

echo "__INSTALL__"
npm ci

if (( BUILD_FRONTEND )); then
  echo "__FRONTEND_STAGE__"
  mkdir -p "$STAGING_DIR"
  ./node_modules/.bin/tsc -b
  ./node_modules/.bin/vite build --outDir "$STAGING_DIR/dist" --emptyOutDir
  test -s "$STAGING_DIR/dist/index.html"

  echo "__FRONTEND_CONTRACT__"
  node "$PINNED_GUARD_DIR/verify-frontend-release.mjs" \
    --candidate "$STAGING_DIR/dist" \
    --baseline "$PROJECT_DIR/dist" \
    --contract "$PINNED_GUARD_DIR/production-ui-contract.json" \
    --commit "$ACTUAL_COMMIT" \
    --write-manifest "$BACKUP_DIR/frontend-release-manifest.json"

  if [[ ! -d "$PROJECT_DIR/dist" ]]; then
    echo "[deploy] current frontend dist is missing; refusing unsafe cutover" >&2
    exit 32
  fi

  echo "__FRONTEND_CUTOVER__"
  mv -- "$PROJECT_DIR/dist" "$ROLLBACK_DIST"
  mv -- "$STAGING_DIR/dist" "$PROJECT_DIR/dist"
  FRONTEND_SWITCHED=1
fi

echo "__RESTART__"
if pm2 describe "$PM2_RESTORE_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_RESTORE_APP" --update-env
else
  pm2 start ecosystem.config.cjs --only "$PM2_RESTORE_APP" --update-env
fi
pm2 restart "$PM2_APP" --update-env
pm2 save

echo "__API_HEALTH__"
attempt=0
until curl -fsS "$HEALTH_URL"; do
  attempt=$((attempt + 1))
  if (( attempt >= HEALTH_ATTEMPTS )); then
    echo "[deploy] API health check failed after $attempt attempts" >&2
    pm2 logs "$PM2_APP" --lines 80 --nostream || true
    exit 41
  fi
  sleep "$HEALTH_INTERVAL_SECONDS"
done
echo

if (( BUILD_FRONTEND )); then
  echo "__EXTERNAL_FRONTEND_HEALTH__"
  curl -fsS --max-time 20 "$EXTERNAL_URL/" >/dev/null
  curl -fsS --max-time 20 "$EXTERNAL_URL/__edge/health" >/dev/null

  echo "__AUTHENTICATED_UI_SMOKE__"
  DEPLOY_UI_BASE_URL="$EXTERNAL_URL" \
  DEPLOY_UI_EXPECTED_COMMIT="$ACTUAL_COMMIT" \
  bash -lc "$UI_SMOKE_COMMAND"

  node "$PINNED_GUARD_DIR/verify-frontend-release.mjs" \
    --candidate "$PROJECT_DIR/dist" \
    --contract "$PINNED_GUARD_DIR/production-ui-contract.json" \
    --commit "$ACTUAL_COMMIT" \
    --write-manifest "$BACKUP_DIR/live-frontend-release-manifest.json"

  mv -- "$ROLLBACK_DIST" "$BACKUP_DIR/dist-before"
  FRONTEND_SWITCHED=0
fi

cleanup_staging
trap - ERR INT TERM

pm2 pid "$PM2_APP"
printf 'commit=%s\nbackup=%s\ncomponent=%s\nfrontend_build=%s\ncompleted_at=%s\n' \
  "$ACTUAL_COMMIT" \
  "$BACKUP_DIR" \
  "$DEPLOY_COMPONENT" \
  "$BUILD_FRONTEND" \
  "$(date -Iseconds)" | tee "$BACKUP_BASE/latest-success.txt"
echo "__DEPLOY_SUCCESS__"
