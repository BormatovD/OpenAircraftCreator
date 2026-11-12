#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! "$1" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$ ]]; then
  echo 'Usage: bash deploy/rollback.sh DEPLOY_USER@HOST' >&2; exit 2
fi
TARGET="$1"; SITE=/srv/aircraft-designer
ssh "$TARGET" "set -eu; test -s '$SITE/previous'; release=\$(cat '$SITE/previous'); test -s \"\$release/index.html\"; ln -sfn \"\$release\" '$SITE/.current.new'; mv -Tf '$SITE/.current.new' '$SITE/current'; printf 'Rolled back to %s\\n' \"\$release\""
