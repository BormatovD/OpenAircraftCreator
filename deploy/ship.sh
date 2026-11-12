#!/usr/bin/env bash
# Build locally on macOS/Linux; rsync a versioned release; atomically change symlink on Ubuntu.
# Usage: bash deploy/ship.sh user@host aircraft-designer.app
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: bash deploy/ship.sh DEPLOY_USER@HOST" >&2
  exit 2
fi
TARGET="$1"
DOMAIN="aircraft-designer.app"
if [[ ! "$TARGET" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$ ]]; then echo 'Invalid SSH target' >&2; exit 2; fi
for cmd in npm ssh rsync curl; do command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 2; }; done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ ! -f package.json ]]; then echo 'Run from a repository where deploy/ is at root.' >&2; exit 2; fi
if [[ -n "$(git status --porcelain)" ]]; then echo "Commit or stash your local changes before deploying" >&2; exit 1; fi
npm test
npm run typecheck
npm run build
if [[ ! -f dist/index.html ]]; then echo 'Build did not produce dist/index.html' >&2; exit 1; fi
GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
REL="$(date -u +%Y%m%dT%H%M%SZ)-${GIT_REF}"
printf '%s\n' "$REL" > dist/release-id.txt
SITE="/srv/aircraft-designer"
DEST="$SITE/releases/$REL"
printf 'Publishing %s to %s:%s\n' "$REL" "$TARGET" "$DEST"
ssh "$TARGET" "mkdir -p '$DEST' && test -w '$DEST'"
rsync -a --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r dist/ "$TARGET:$DEST/"
# Capture last working release for rollback. Atomic symlink replacement uses GNU mv on Ubuntu.
ssh "$TARGET" "set -eu; test -s '$DEST/index.html'; previous=\$(readlink '$SITE/current' || true); if [ -n \"\$previous\" ]; then printf '%s\\n' \"\$previous\" > '$SITE/previous'; fi; ln -sfn '$DEST' '$SITE/.current.new'; mv -Tf '$SITE/.current.new' '$SITE/current'"
# Verify the NEW version, not just an old cached index page.
if curl -fsSL --max-time 20 --retry 4 --retry-delay 2 -H 'Cache-Control: no-cache' "https://$DOMAIN/release-id.txt" | grep -Fxq "$REL"; then
  echo "Published: https://$DOMAIN/ (release $REL)"
else
  echo 'Health check failed. Attempting rollback.' >&2
  ssh "$TARGET" "set -eu; if test -s '$SITE/previous'; then ln -sfn \"\$(cat '$SITE/previous')\" '$SITE/.current.new'; mv -Tf '$SITE/.current.new' '$SITE/current'; else rm -f '$SITE/current'; fi" || true
  exit 1
fi
