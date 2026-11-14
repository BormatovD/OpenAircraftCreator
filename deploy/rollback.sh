#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! "$1" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$ ]]; then
  echo 'Usage: bash deploy/rollback.sh DEPLOY_USER@HOST' >&2; exit 2
fi
TARGET="$1"; SITE=/srv/aircraft-designer
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$(ssh "$TARGET" "bash -s -- '$SITE'" < "$SCRIPT_DIR/switch-release.sh")"
EXPECTED="${STATE%%$'\n'*}"
[[ "$EXPECTED" != EMPTY ]] || { echo 'No active release to roll back.' >&2; exit 1; }
ssh "$TARGET" "bash -s -- '$SITE' '$EXPECTED' PREVIOUS rollback" < "$SCRIPT_DIR/switch-release.sh"
