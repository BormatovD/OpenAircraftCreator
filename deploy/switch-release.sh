#!/usr/bin/env bash
# Runs on Ubuntu over SSH. One argument reads state; four atomically switch it.
set -euo pipefail
fail() { echo "Release switch blocked: $*" >&2; exit 1; }
valid_id() { [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}$ ]]; }
metadata() {
  local value
  [[ -f "$1" && ! -L "$1" ]] || fail "missing metadata: $1"
  [[ "$(wc -l < "$1")" -le 1 ]] || fail "multiline metadata: $1"
  value="$(cat "$1")"
  [[ -n "$value" && "$value" != *$'\n'* ]] || fail "empty or multiline metadata: $1"
  printf '%s' "$value"
}
[[ $# -eq 1 || $# -eq 4 ]] || fail 'expected SITE [EXPECTED NEXT promote|rollback]'
[[ -d "$1/releases" ]] || fail 'release directory is missing'
SITE="$(cd "$1" && pwd -P)"
load_release() {
  local suffix
  RELEASE_PATH="$(readlink -f -- "$1")" || fail 'cannot resolve release path'
  [[ -d "$RELEASE_PATH" && -s "$RELEASE_PATH/index.html" && ! -L "$RELEASE_PATH/index.html" ]] || fail 'release artifact is missing'
  RELEASE_ID="$(metadata "$RELEASE_PATH/release-id.txt")"
  valid_id "$RELEASE_ID" || fail 'invalid release ID'
  [[ "$RELEASE_PATH" == "$SITE/releases/$RELEASE_ID" ]] || fail 'release path does not match its ID'
  RELEASE_SHA=-
  if [[ -e "$RELEASE_PATH/release-commit.txt" || -L "$RELEASE_PATH/release-commit.txt" ]]; then
    RELEASE_SHA="$(metadata "$RELEASE_PATH/release-commit.txt")"
    [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid commit metadata'
    suffix="${RELEASE_ID#*-}"
    [[ "$RELEASE_SHA" == "$suffix"* ]] || fail 'commit metadata does not match release ID'
  fi
}
read_current() {
  CURRENT_ID=EMPTY; CURRENT_SHA=-; CURRENT_PATH=
  if [[ ! -e "$SITE/current" && ! -L "$SITE/current" ]]; then return; fi
  [[ -L "$SITE/current" ]] || fail 'current is not a symlink'
  load_release "$SITE/current"
  CURRENT_ID="$RELEASE_ID"; CURRENT_SHA="$RELEASE_SHA"; CURRENT_PATH="$RELEASE_PATH"
}
if [[ $# -eq 1 ]]; then
  read_current
  printf '%s\n%s\n' "$CURRENT_ID" "$CURRENT_SHA"
  exit 0
fi
EXPECTED="$2"; NEXT="$3"; ACTION="$4"
[[ "$EXPECTED" == EMPTY ]] || valid_id "$EXPECTED" || fail 'invalid expected release'
[[ "$ACTION" == promote || "$ACTION" == rollback ]] || fail 'invalid action'
if [[ "$NEXT" == PREVIOUS || "$NEXT" == EMPTY ]]; then
  [[ "$ACTION" == rollback && "$EXPECTED" != EMPTY ]] || fail 'invalid rollback target'
else
  valid_id "$NEXT" || fail 'invalid next release'
fi
exec 9>"$SITE/.deploy.lock"
flock -w 30 9 || fail 'another deployment is holding the release lock'
read_current
[[ "$CURRENT_ID" == "$EXPECTED" ]] || fail "current release changed from $EXPECTED to $CURRENT_ID; rerun preflight"
if [[ "$NEXT" == PREVIOUS ]]; then
  load_release "$(metadata "$SITE/previous")"
  NEXT="$RELEASE_ID"
fi
if [[ "$NEXT" == EMPTY ]]; then
  rm -- "$SITE/current"
  echo 'Removed failed initial release.'
  exit 0
fi
[[ "$NEXT" != "$CURRENT_ID" ]] || fail 'target release is already current'
load_release "$SITE/releases/$NEXT"
[[ "$RELEASE_ID" == "$NEXT" ]] || fail 'target release path resolves to a different ID'
if [[ "$ACTION" == promote ]]; then
  [[ "$RELEASE_SHA" != - ]] || fail 'new releases require full commit metadata'
  PARENT="$(metadata "$RELEASE_PATH/release-parent.txt")"
  [[ "$PARENT" == "$EXPECTED" ]] || fail 'release was built against a different published version'
fi
CURRENT_TEMP="$SITE/.current.$$"; PREVIOUS_TEMP="$SITE/.previous.$$"
trap 'rm -f -- "$CURRENT_TEMP" "$PREVIOUS_TEMP"' EXIT
if [[ "$ACTION" == promote && -n "$CURRENT_PATH" ]]; then
  printf '%s\n' "$CURRENT_PATH" > "$PREVIOUS_TEMP"
  mv -f -- "$PREVIOUS_TEMP" "$SITE/previous"
fi
ln -s -- "$RELEASE_PATH" "$CURRENT_TEMP"
mv -Tf -- "$CURRENT_TEMP" "$SITE/current"
printf 'Activated %s\n' "$RELEASE_ID"
