# Release to https://aircraft-designer.app — Ubuntu + Caddy

This package replaces the AirframeLab deploy directory. It does not require Docker or Node.js on the VPS; the app is built locally into `dist/index.html`.

## One-time setup

1. Register `aircraft-designer.app` and create a DNS **A** record pointing to your VPS IPv4. Configure AAAA only if IPv6 works. The `.app` TLD is HTTPS-only in browsers because of HSTS preload.
2. On Ubuntu, create a non-root `deploy` account with SSH key access. Give it an authorized way to deploy into `/srv/aircraft-designer`. Install `rsync` (`sudo apt-get install rsync`) and Caddy using https://caddyserver.com/docs/install . Expose TCP 80 and 443; restrict TCP 22 to your IP if possible.
3. Copy `deploy/init-server.sh` and `deploy/aircraft-designer.caddy` onto the VPS as a `deploy/` folder. Run `sudo bash deploy/init-server.sh deploy` (replace `deploy` with your Unix user).
4. The initializer creates an **additional Caddy site fragment** under `/etc/caddy/sites-enabled/` and appends the `import` line to the Caddyfile if missing. It makes a backup, validates and reloads Caddy. Inspect it before running if other sites already exist on the VPS.
5. Confirm `sudo systemctl status caddy` and `sudo caddy validate --config /etc/caddy/Caddyfile`. The first HTTPS visit will only succeed after DNS and a first app release.

## Upload a release (run on your Mac, from the project root)

Copy the `deploy` directory into the root of the local repository and commit it. `ship.sh` requires a clean working tree so your deployed build corresponds to a commit:

```bash
bash deploy/ship.sh deploy@YOUR_VPS_IP
```

This script checks tests/TypeScript, builds `dist/`, uploads it to a timestamped release, switches `/srv/aircraft-designer/current` and verifies the **exact new release ID** at `https://aircraft-designer.app/release-id.txt` (not merely an old cached homepage). On failure it attempts rollback.

For existing installations, apply the passport proxy from `deploy/aircraft-designer.caddy` to the active site fragment, validate the Caddyfile and reload Caddy. The live passport uses `GET /api/aircraft/type?icao=A321`. Until the proxy is active, the UI shows the dated FlightCost snapshot bundled in the release.

## Roll back the last deployment

```bash
bash deploy/rollback.sh deploy@YOUR_VPS_IP
```

**Only `dist/` is published**; never copy `.env`, source files, FCOM manuals, `analysis/` or `.git` into the web root. The scripts have undergone shell syntax checks, not a live VPS run. After first deployment, test rollback and check that stale browser caches do not hide the new version.

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
