#!/usr/bin/env bash
# Build locally; check published ancestry; atomically activate on Ubuntu.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 || ( $# -eq 2 && "$2" != --initial ) ]]; then
  echo 'Usage: bash deploy/ship.sh DEPLOY_USER@HOST [--initial]' >&2; exit 2
fi
TARGET="$1"; INITIAL="${2:-}"; DOMAIN=aircraft-designer.app; SITE=/srv/aircraft-designer
[[ "$TARGET" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid SSH target' >&2; exit 2; }
for cmd in node npm git ssh rsync curl; do
  command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 2; }
done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f package.json ]] || { echo 'deploy/ must be at the repository root.' >&2; exit 2; }
read_server() {
  local state extra
  state="$(ssh "$TARGET" "bash -s -- '$SITE'" < deploy/switch-release.sh)"
  {
    IFS= read -r SERVER_ID
    IFS= read -r SERVER_SHA
    if IFS= read -r extra; then echo 'Unexpected server state response.' >&2; return 1; fi
  } <<< "$state"
}
check_published() {
  local response
  read_server
  response="$(curl --proto '=https' -sSL --max-time 20 --retry 2 -H 'Cache-Control: no-cache' --write-out $'\n%{http_code}' "https://$DOMAIN/release-id.txt")"
  PUBLIC_STATUS="${response##*$'\n'}"
  PUBLIC_ID="$(printf '%s' "${response%$'\n'*}")"
  if [[ "$SERVER_ID" == EMPTY ]]; then
    [[ "$INITIAL" == --initial ]] || { echo 'No current release. Use --initial only for a first deployment.' >&2; return 1; }
    [[ "$PUBLIC_STATUS" == 404 ]] || { echo 'Deployment blocked: first deployment requires public HTTP 404 and an empty server.' >&2; return 1; }
  else
    [[ "$INITIAL" != --initial ]] || { echo '--initial cannot bypass an existing release.' >&2; return 1; }
    [[ "$PUBLIC_STATUS" == 200 && "$PUBLIC_ID" == "$SERVER_ID" ]] || { echo 'Deployment blocked: public and SSH release IDs differ or HTTPS did not return 200.' >&2; return 1; }
    node deploy/check-release.mjs "$SERVER_ID" "$SERVER_SHA"
  fi
}
# This runs before tests, builds, uploads or any server mutation.
check_published
EXPECTED_ID="$SERVER_ID"; EXPECTED_SHA="$SERVER_SHA"
PINNED_SHA="$(git rev-parse --verify 'HEAD^{commit}')"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo 'Commit or stash local changes before deploying.' >&2; exit 1; }
npm test
npm run typecheck
npm run build
[[ -s dist/index.html ]] || { echo 'Build did not produce dist/index.html.' >&2; exit 1; }
[[ "$(git rev-parse --verify 'HEAD^{commit}')" == "$PINNED_SHA" ]] || { echo 'HEAD changed during the build.' >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo 'Source changed during the build.' >&2; exit 1; }
# A second deploy may have completed while the build was running.
check_published
[[ "$SERVER_ID" == "$EXPECTED_ID" && "$SERVER_SHA" == "$EXPECTED_SHA" ]] || { echo 'Published release changed during the build; rerun deployment.' >&2; exit 1; }
REL="$(date -u +%Y%m%dT%H%M%SZ)-$PINNED_SHA"
DEST="$SITE/releases/$REL"
printf '%s\n' "$REL" > dist/release-id.txt
printf '%s\n' "$PINNED_SHA" > dist/release-commit.txt
printf '%s\n' "$EXPECTED_ID" > dist/release-parent.txt
printf 'Publishing %s to %s:%s\n' "$REL" "$TARGET" "$DEST"
ssh "$TARGET" "mkdir '$DEST' && test -w '$DEST'"
rsync -a --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r dist/ "$TARGET:$DEST/"
# The server lock and expected-current check also close the upload/switch race.
ssh "$TARGET" "bash -s -- '$SITE' '$EXPECTED_ID' '$REL' promote" < deploy/switch-release.sh
if [[ "$(curl --proto '=https' -fsSL --max-time 20 --retry 4 --retry-delay 2 -H 'Cache-Control: no-cache' "https://$DOMAIN/release-id.txt")" == "$REL" ]]; then
  echo "Published: https://$DOMAIN/ (release $REL)"
else
  echo 'Health check failed. Attempting rollback only if this release is still current.' >&2
  ssh "$TARGET" "bash -s -- '$SITE' '$REL' '$EXPECTED_ID' rollback" < deploy/switch-release.sh || true
  exit 1
fi
