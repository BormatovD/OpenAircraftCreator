#!/usr/bin/env bash
# Run once on Ubuntu after installing Caddy. Does not delete existing sites.
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: sudo bash deploy/init-server.sh DEPLOY_UNIX_USER" >&2; exit 2; fi
DEPLOY_USER="$1"
if (( EUID != 0 )); then echo "Run with sudo" >&2; exit 2; fi
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then echo "Unknown deployment user: $DEPLOY_USER" >&2; exit 2; fi
command -v caddy >/dev/null || { echo "Install Caddy first: https://caddyserver.com/docs/install" >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE=/srv/aircraft-designer
CADDYFILE=/etc/caddy/Caddyfile
SITEFILE=/etc/caddy/sites-enabled/aircraft-designer.caddy
IMPORT='import /etc/caddy/sites-enabled/*.caddy'
install -d -m 755 -o "$DEPLOY_USER" -g "$(id -gn "$DEPLOY_USER")" "$SITE" "$SITE/releases"
install -d -m 755 /etc/caddy/sites-enabled
if [[ -f "$SITEFILE" ]]; then echo "Existing site configuration: $SITEFILE. Review before rerunning." >&2; exit 1; fi
if [[ ! -f "$CADDYFILE" ]]; then echo "Missing $CADDYFILE; install Caddy first" >&2; exit 1; fi
if grep -q 'aircraft-designer\.app' "$CADDYFILE"; then echo "Domain already configured in $CADDYFILE" >&2; exit 1; fi
BACKUP="${CADDYFILE}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$CADDYFILE" "$BACKUP"
install -m 644 "$SCRIPT_DIR/aircraft-designer.caddy" "$SITEFILE"
if ! grep -Fq "$IMPORT" "$CADDYFILE"; then printf '\n%s\n' "$IMPORT" >> "$CADDYFILE"; fi
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile; then
  cp -a "$BACKUP" "$CADDYFILE"; rm -f "$SITEFILE"
  echo "Caddy configuration failed; restored $BACKUP" >&2; exit 1
fi
systemctl enable --now caddy
systemctl reload caddy
printf "Configured https://aircraft-designer.app ; deploy to %s/releases\n" "$SITE"
