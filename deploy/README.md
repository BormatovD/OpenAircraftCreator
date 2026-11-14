# Release to https://aircraft-designer.app — Ubuntu + Caddy

This package replaces the AirframeLab deploy directory. It does not require Docker or Node.js on the VPS; the app is built locally into `dist/index.html`.

## One-time setup

1. Register `aircraft-designer.app` and create a DNS **A** record pointing to your VPS IPv4. Configure AAAA only if IPv6 works. The `.app` TLD is HTTPS-only in browsers because of HSTS preload.
2. On Ubuntu, create a non-root `deploy` account with SSH key access. Give it an authorized way to deploy into `/srv/aircraft-designer`. Install `rsync` (`sudo apt-get install rsync`) and Caddy using https://caddyserver.com/docs/install . Expose TCP 80 and 443; restrict TCP 22 to your IP if possible.
3. Copy `deploy/init-server.sh` and `deploy/aircraft-designer.caddy` onto the VPS as a `deploy/` folder. Run `sudo bash deploy/init-server.sh deploy` (replace `deploy` with your Unix user).
4. The initializer creates an **additional Caddy site fragment** under `/etc/caddy/sites-enabled/` and appends the `import` line to the Caddyfile if missing. It makes a backup, validates and reloads Caddy. Inspect it before running if other sites already exist on the VPS.
5. Confirm `sudo systemctl status caddy` and `sudo caddy validate --config /etc/caddy/Caddyfile`. The first HTTPS visit will only succeed after DNS and a first app release.

## Upload a release (run on your Mac, from the project root)

Keep the current `deploy` directory in the repository and commit your changes. `ship.sh` requires a clean working tree so your deployed build corresponds to a commit:

```bash
bash deploy/ship.sh deploy@YOUR_VPS_IP
```

Before building or uploading, the script reads the published release over HTTPS and SSH and requires both IDs to agree. Its commit must be an ancestor of local `HEAD`; an old or divergent branch is blocked. Fetch the published history and merge/update your branch if this check fails. Missing or malformed release metadata fails closed. Existing releases with a short commit in their ID remain supported if that commit resolves uniquely in local history.

The script then runs tests/TypeScript, builds `dist/`, and verifies that `HEAD` and the source tree have not changed during the build. It rechecks the published release and uploads a new directory containing the full commit SHA and the release it was built against. On Ubuntu, `switch-release.sh` holds a `flock` lock and compares the expected current release immediately before the atomic switch. Two deployments based on the same release cannot both activate. The final HTTPS check requires the **exact new release ID**; automatic rollback is allowed only while that failed release is still current.

For a genuinely empty installation only, append `--initial`. This requires HTTP 404 for the public release ID and an absent server current release; transport failures and other HTTP statuses block deployment. This flag cannot bypass an existing or broken current release. The server needs GNU `readlink`, `mv`, and `flock` (Ubuntu packages `coreutils` and `util-linux`). No Node.js is needed on the server.

Use this updated deployment entry point in every working checkout. The guard prevents accidental stale deployments through these scripts; a historical script or a manual SSH command can still bypass it while the deploy account owns the site directory. Enforcing the same policy against arbitrary SSH commands would require a separately administered server activation service.

For existing installations, apply the passport proxy from `deploy/aircraft-designer.caddy` to the active site fragment, validate the Caddyfile and reload Caddy. The live passport uses `GET /api/aircraft/type?icao=A321`. Until the proxy is active, the UI shows the dated FlightCost snapshot bundled in the release.

## Roll back the last deployment

```bash
bash deploy/rollback.sh deploy@YOUR_VPS_IP
```

Rollback is an explicit exception to the forward-only ancestry rule. It checks and locks the expected current release, validates the previous artifact, and preserves the previous-release record. A delayed rollback cannot overwrite a newer deployment.

**Only `dist/` is published**; never copy `.env`, source files, FCOM manuals, `analysis/` or `.git` into the web root. Automated tests cover Git ancestry, malformed state, concurrent activation and rollback. Test server changes in an isolated directory before using them for a live release.

## Prerequisites to go live

The domain name alone is not hosting. You also need:

- VPS (recommended 2 vCPU, 2 GB RAM, 30–40 GB SSD), Ubuntu 24.04 and public IPv4.
- DNS `A` record for `@` pointing to that IPv4. Do not add an `AAAA` record unless IPv6 is configured.
- A `deploy` system user with SSH public-key login; no passwords or SSH private keys in Git.
- `caddy` and `rsync` installed on the server, and inbound TCP 80/443 allowed. Restrict SSH/22 to your own IP where feasible.

The `/srv/aircraft-designer/current` symlink serves only `dist/`. Never copy the repo, source PDF manuals or `.env` to the web directory.

## Operational checks

1. Open both `https://aircraft-designer.app/` and `https://aircraft-designer.app/release-id.txt`.
2. On mobile/desktop, select A320, 737-8, 757 RB211/PW and Tu-214 factory/operational. Switch flight phases, choose an ATA aggregate, move a lever, switch theme, open “Как рассчитано”.
3. Test full and selected explosion and low-power hardware; confirm the HUD, cockpit, labels and the interior remain usable.
4. Test `deploy/rollback.sh` and then release again. Confirm HTTPS renewals (`journalctl -u caddy`).

### CI

`.github/workflows/quality.yml` builds and tests on every push and pull request using Node 22.18.0. It uploads a `site-dist` artifact. CI does **not** receive VPS SSH keys; release deployment remains manual on your trusted computer.
