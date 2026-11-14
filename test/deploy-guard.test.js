import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkReleaseBase } from "../deploy/check-release.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseCheckCli = join(repoRoot, "deploy/check-release.mjs");
const releaseSwitch = join(repoRoot, "deploy/switch-release.sh");

function temporary(t, prefix = "oac-deploy-guard-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "--quiet");
  git(dir, "config", "user.name", "Deploy Guard Tests");
  git(dir, "config", "user.email", "deploy-guard@example.invalid");
  return dir;
}

function commitFile(repo, name, content, message = name) {
  writeFileSync(join(repo, name), content);
  git(repo, "add", name);
  git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function releaseId(sha, stamp = "20261114T182009Z") {
  return `${stamp}-${sha.slice(0, 12)}`;
}

function siteRelease(site, id, commit, parent) {
  const dir = join(site, "releases", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), `<!doctype html><title>${id}</title>\n`);
  writeFileSync(join(dir, "release-id.txt"), `${id}\n`);
  writeFileSync(join(dir, "release-commit.txt"), `${commit}\n`);
  writeFileSync(join(dir, "release-parent.txt"), `${parent}\n`);
  return `releases/${id}`;
}

function linkCurrent(site, target) {
  symlinkSync(target, join(site, "current"));
}

function switchFixture(t) {
  const root = temporary(t, "oac-switch-test-");
  const site = join(root, "site with spaces");
  const shims = join(root, "bin");
  mkdirSync(join(site, "releases"), { recursive: true });
  mkdirSync(shims, { recursive: true });

  // flock(1) is not shipped with macOS. This shim locks the helper's inherited
  // FD 9 with Perl's native flock, so the lock remains held until Bash exits.
  writeFileSync(join(shims, "flock"), `#!/bin/sh\nexec /usr/bin/perl -MFcntl=:flock -e 'open my $fh, ">&=9" or die $!; flock($fh, LOCK_EX) or die $!'\n`);
  // GNU mv -T is also absent on macOS. The helper only atomically replaces a
  // current symlink here, so POSIX rename is the relevant behavior to test.
  writeFileSync(join(shims, "mv"), `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst paths = process.argv.slice(2).filter(a => !a.startsWith("-"));\nif (paths.length !== 2) process.exit(2);\nfs.renameSync(paths[0], paths[1]);\n`);
  execFileSync("chmod", ["+x", join(shims, "flock"), join(shims, "mv")]);
  return {
    root,
    site,
    env: { ...process.env, PATH: `${shims}:${process.env.PATH}`, OAC_DEPLOY_TEST_SITE: site },
  };
}

function runSwitch(site, expected, next, action = "promote", env = process.env) {
  return spawnSync("bash", [releaseSwitch, site, expected, next, action], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function assertSwitchBlocked(result, message) {
  assert.notEqual(result.status, 0, message ?? result.stdout);
}

function releaseMeta(site, name, parent = "-") {
  const commit = name.repeat(40);
  const stamp = name === "a" ? "20261114T180000Z" : name === "b" ? "20261114T181000Z" : "20261114T182000Z";
  const id = `${stamp}-${commit.slice(0, 12)}`;
  const target = siteRelease(site, id, commit, parent);
  return { id, commit, target };
}

function shipFixture(t) {
  const root = temporary(t, "oac-ship-preflight-");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const marker = join(root, "unexpected-side-effect");
  mkdirSync(join(repo, "deploy"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const file of ["ship.sh", "check-release.mjs", "switch-release.sh"])
    copyFileSync(join(repoRoot, "deploy", file), join(repo, "deploy", file));
  writeFileSync(join(repo, "package.json"), '{"name":"ship-preflight-fixture"}\n');

  const sshStub = join(bin, "ssh");
  writeFileSync(sshStub, `#!/bin/sh\ncat >/dev/null\nprintf '%s' "${"$"}{OAC_TEST_SSH_OUTPUT:-}"\n`);
  const curlStub = join(bin, "curl");
  writeFileSync(curlStub, `#!/bin/sh\nprintf '%s' "${"$"}{OAC_TEST_CURL_OUTPUT:-}"\nexit "${"$"}{OAC_TEST_CURL_STATUS:-0}"\n`);
  for (const name of ["npm", "rsync"]) {
    const stub = join(bin, name);
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' '${name} invoked' >> "${"$"}OAC_TEST_MARKER"\nexit 97\n`);
  }
  execFileSync("chmod", ["+x", sshStub, curlStub, join(bin, "npm"), join(bin, "rsync")]);

  git(repo, "init", "--quiet");
  git(repo, "config", "user.name", "Ship Preflight Tests");
  git(repo, "config", "user.email", "ship-preflight@example.invalid");
  git(repo, "add", "deploy", "package.json");
  git(repo, "commit", "--quiet", "-m", "fixture deploy scripts");
  const publishedSha = git(repo, "rev-parse", "HEAD");
  writeFileSync(join(repo, "unfinished-local-change.txt"), "dirty fixture\n");
  return {
    repo,
    marker,
    publishedSha,
    publishedId: `20261114T182009Z-${publishedSha.slice(0, 12)}`,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OAC_TEST_MARKER: marker,
      OAC_TEST_SSH_OUTPUT: "EMPTY\n-\n",
    },
  };
}

function runInitialShip(fixture, curlOutput, curlStatus = 0) {
  return spawnSync("bash", [join(fixture.repo, "deploy/ship.sh"), "tester@example.invalid", "--initial"], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { ...fixture.env, OAC_TEST_CURL_OUTPUT: curlOutput, OAC_TEST_CURL_STATUS: String(curlStatus) },
  });
}

test("release base accepts the published commit itself and a real descendant", async t => {
  const repo = initRepo(temporary(t, "oac-git-base-"));
  const published = commitFile(repo, "model.txt", "published\n");
  const candidate = commitFile(repo, "math.txt", "candidate\n");

  assert.deepEqual(await checkReleaseBase({ releaseId: releaseId(published), commitSha: published, cwd: repo }), {
    publishedCommit: published,
    candidateCommit: candidate,
  });
  assert.deepEqual(await checkReleaseBase({ releaseId: releaseId(candidate), commitSha: "-", cwd: repo }), {
    publishedCommit: candidate,
    candidateCommit: candidate,
  });
});

test("release base rejects malformed IDs, unknown commits, and release metadata mismatch", t => {
  const repo = initRepo(temporary(t, "oac-git-invalid-"));
  const published = commitFile(repo, "model.txt", "published\n");
  const other = commitFile(repo, "math.txt", "candidate\n");

  for (const malformed of [
    "20261114-abcdef0",
    "20261114T182009Z-abc123",
    "20261114T182009Z-zzzzzzz",
    "20261114T182009Z-abcdefg-extra",
    `20261114T182009Z-${"a".repeat(41)}`,
  ]) {
    assert.throws(() => checkReleaseBase({ releaseId: malformed, cwd: repo }), undefined, malformed);
  }
  assert.throws(() => checkReleaseBase({ releaseId: `20261114T182009Z-${"f".repeat(40)}`, cwd: repo }));
  assert.throws(() => checkReleaseBase({ releaseId: releaseId(published), commitSha: other, cwd: repo }));
});

test("release base rejects a divergent candidate even when both commits exist locally", t => {
  const repo = initRepo(temporary(t, "oac-git-diverged-"));
  const common = commitFile(repo, "common.txt", "common\n");
  git(repo, "branch", "published");
  const published = commitFile(repo, "published.txt", "release\n");
  git(repo, "checkout", "--quiet", "-b", "candidate", common);
  const candidate = commitFile(repo, "candidate.txt", "other line\n");
  assert.notEqual(candidate, published);

  assert.throws(() => checkReleaseBase({ releaseId: releaseId(published), cwd: repo }));
});

test("release base rejects a cherry-pick whose patch is present but whose release commit is not an ancestor", t => {
  const repo = initRepo(temporary(t, "oac-git-cherry-pick-"));
  const common = commitFile(repo, "common.txt", "common\n");
  const published = commitFile(repo, "math.txt", "same patch\n", "published math change");
  git(repo, "checkout", "--quiet", "-b", "candidate", common);
  const candidate = commitFile(repo, "math.txt", "same patch\n", "cherry-picked math change");
  assert.notEqual(candidate, published);

  assert.throws(() => checkReleaseBase({ releaseId: releaseId(published), cwd: repo }));
});

test("release checker CLI returns success only for a descendant candidate", t => {
  const repo = initRepo(temporary(t, "oac-git-cli-"));
  const published = commitFile(repo, "published.txt", "site\n");
  const candidate = commitFile(repo, "candidate.txt", "next\n");
  const ok = spawnSync(process.execPath, [releaseCheckCli, releaseId(published), published], {
    cwd: repo, encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);

  git(repo, "checkout", "--quiet", "-b", "stale", published);
  commitFile(repo, "stale.txt", "unrelated\n");
  const blocked = spawnSync(process.execPath, [releaseCheckCli, releaseId(candidate), candidate], {
    cwd: repo, encoding: "utf8",
  });
  assert.equal(blocked.status, 1);
});

test("initial ship accepts only a public HTTP 404 when SSH reports EMPTY", t => {
  const fixture404 = shipFixture(t);
  const missing = runInitialShip(fixture404, "Not found\n\n404\n");
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /Commit or stash local changes before deploying/);
  assert.doesNotMatch(`${missing.stdout}\n${missing.stderr}`, /HTTP 200|public and SSH release IDs differ/);

  const releaseId = "20261114T182009Z-2e91303";
  const fixture200 = shipFixture(t);
  const live = runInitialShip(fixture200, `${releaseId}\n\n200\n`);
  assert.notEqual(live.status, 0);
  const liveOutput = `${live.stdout}\n${live.stderr}`;
  assert.match(liveOutput, /public|release|HTTP 200|EMPTY/i);
  assert.doesNotMatch(liveOutput, /Commit or stash local changes before deploying/);

  const fixtureExisting = shipFixture(t);
  const existingEnvironment = {
    ...fixtureExisting.env,
    OAC_TEST_SSH_OUTPUT: `${fixtureExisting.publishedId}\n${fixtureExisting.publishedSha}\n`,
  };
  const existing = spawnSync("bash", [join(fixtureExisting.repo, "deploy/ship.sh"), "tester@example.invalid"], {
    cwd: fixtureExisting.repo,
    encoding: "utf8",
    env: { ...existingEnvironment, OAC_TEST_CURL_OUTPUT: `${fixtureExisting.publishedId}\n\n200\n`, OAC_TEST_CURL_STATUS: "0" },
  });
  assert.notEqual(existing.status, 0);
  assert.match(`${existing.stdout}\n${existing.stderr}`, /Commit or stash local changes before deploying/);

  for (const [response, status] of [["Server error\n\n500\n", 0], ["", 28]]) {
    const unavailable = shipFixture(t);
    const blocked = runInitialShip(unavailable, response, status);
    assert.notEqual(blocked.status, 0);
    assert.doesNotMatch(`${blocked.stdout}\n${blocked.stderr}`, /Commit or stash local changes before deploying/);
  }
  for (const fixture of [fixture404, fixture200, fixtureExisting]) assert.equal(existsSync(fixture.marker), false);
});

test("server switch promotes from the expected release and records the previous target", t => {
  const { site, env } = switchFixture(t);
  const current = releaseMeta(site, "a");
  const next = releaseMeta(site, "b", current.id);
  linkCurrent(site, current.target);

  const result = runSwitch(site, current.id, next.id, "promote", env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), next.id);
  assert.equal(readFileSync(join(site, "previous"), "utf8").trim(), realpathSync(join(site, current.target)));
});

test("bootstrap promotion is allowed only when current is truly absent", t => {
  const empty = switchFixture(t);
  const first = releaseMeta(empty.site, "a", "EMPTY");
  const bootstrapped = runSwitch(empty.site, "EMPTY", first.id, "promote", empty.env);
  assert.equal(bootstrapped.status, 0, bootstrapped.stderr);
  assert.equal(readFileSync(join(empty.site, "current/release-id.txt"), "utf8").trim(), first.id);

  const broken = switchFixture(t);
  const release = releaseMeta(broken.site, "a", "EMPTY");
  symlinkSync("releases/missing-release", join(broken.site, "current"));
  assertSwitchBlocked(runSwitch(broken.site, "EMPTY", release.id, "promote", broken.env));
  assert.equal(readlinkSync(join(broken.site, "current")), "releases/missing-release");

  const alreadyActive = switchFixture(t);
  const active = releaseMeta(alreadyActive.site, "b", "EMPTY");
  const ignored = releaseMeta(alreadyActive.site, "c", "EMPTY");
  linkCurrent(alreadyActive.site, active.target);
  assertSwitchBlocked(runSwitch(alreadyActive.site, "EMPTY", ignored.id, "promote", alreadyActive.env));
  assert.equal(readFileSync(join(alreadyActive.site, "current/release-id.txt"), "utf8").trim(), active.id);
});

test("server switch refuses stale expected IDs and invalid current or candidate metadata without changing current", t => {
  const { site, env } = switchFixture(t);
  const old = releaseMeta(site, "a");
  const current = releaseMeta(site, "b", old.id);
  const next = releaseMeta(site, "c", current.id);
  linkCurrent(site, current.target);

  const stale = runSwitch(site, old.id, next.id, "promote", env);
  assertSwitchBlocked(stale);
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), current.id);

  writeFileSync(join(site, current.target, "release-commit.txt"), "not-a-full-commit\n");
  assertSwitchBlocked(runSwitch(site, current.id, next.id, "promote", env));
  writeFileSync(join(site, current.target, "release-commit.txt"), `${current.commit}\n`);
  writeFileSync(join(site, current.target, "release-commit.txt"), `${"f".repeat(40)}\n`);
  assertSwitchBlocked(runSwitch(site, current.id, next.id, "promote", env));
  writeFileSync(join(site, current.target, "release-commit.txt"), `${current.commit}\n`);
  writeFileSync(join(site, current.target, "release-id.txt"), `${old.id}\n`);
  assertSwitchBlocked(runSwitch(site, current.id, next.id, "promote", env));
  writeFileSync(join(site, current.target, "release-id.txt"), `${current.id}\n`);
  writeFileSync(join(site, next.target, "release-parent.txt"), `${old.id}\n`);
  assertSwitchBlocked(runSwitch(site, current.id, next.id, "promote", env));
  writeFileSync(join(site, next.target, "release-parent.txt"), `${current.id}\n`);
  writeFileSync(join(site, next.target, "release-commit.txt"), "bad\n");
  assertSwitchBlocked(runSwitch(site, current.id, next.id, "promote", env));
  writeFileSync(join(site, next.target, "release-commit.txt"), `${next.commit}\n`);
  const aliasId = "20261114T182500Z-dddddddddddd";
  symlinkSync(next.id, join(site, "releases", aliasId));
  const alias = runSwitch(site, current.id, aliasId, "promote", env);
  assertSwitchBlocked(alias);
  assert.match(alias.stderr, /different ID/);
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), current.id);
});

test("rollback requires the expected current release and leaves previous untouched", t => {
  const { site, env } = switchFixture(t);
  const old = releaseMeta(site, "a");
  const current = releaseMeta(site, "b", old.id);
  linkCurrent(site, current.target);
  writeFileSync(join(site, "previous"), "operator note\n");

  assertSwitchBlocked(runSwitch(site, old.id, old.id, "rollback", env));
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), current.id);
  assert.equal(readFileSync(join(site, "previous"), "utf8"), "operator note\n");

  writeFileSync(join(site, old.target, "release-commit.txt"), "invalid candidate\n");
  assertSwitchBlocked(runSwitch(site, current.id, old.id, "rollback", env));
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), current.id);
  writeFileSync(join(site, old.target, "release-commit.txt"), `${old.commit}\n`);
  const result = runSwitch(site, current.id, old.id, "rollback", env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), old.id);
  assert.equal(readFileSync(join(site, "previous"), "utf8"), "operator note\n");
});

test("legacy current releases may omit commit metadata, but new promotions require it", t => {
  const { site, env } = switchFixture(t);
  const legacy = releaseMeta(site, "a");
  unlinkSync(join(site, legacy.target, "release-commit.txt"));
  linkCurrent(site, legacy.target);
  const state = spawnSync("bash", [releaseSwitch, site], { cwd: repoRoot, encoding: "utf8", env });
  assert.equal(state.status, 0, state.stderr);
  assert.deepEqual(state.stdout.trim().split("\n"), [legacy.id, "-"]);

  const missingSha = releaseMeta(site, "b", legacy.id);
  unlinkSync(join(site, missingSha.target, "release-commit.txt"));
  assertSwitchBlocked(runSwitch(site, legacy.id, missingSha.id, "promote", env));
  assert.equal(readFileSync(join(site, "current/release-id.txt"), "utf8").trim(), legacy.id);
});

test("rollback may target the previous legacy release or EMPTY, without replacing previous metadata", t => {
  const legacyRollback = switchFixture(t);
  const legacy = releaseMeta(legacyRollback.site, "a");
  unlinkSync(join(legacyRollback.site, legacy.target, "release-commit.txt"));
  const current = releaseMeta(legacyRollback.site, "b", legacy.id);
  linkCurrent(legacyRollback.site, current.target);
  writeFileSync(join(legacyRollback.site, "previous"), `${realpathSync(join(legacyRollback.site, legacy.target))}\n`);
  const rolledBack = runSwitch(legacyRollback.site, current.id, "PREVIOUS", "rollback", legacyRollback.env);
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(readFileSync(join(legacyRollback.site, "current/release-id.txt"), "utf8").trim(), legacy.id);
  assert.equal(readFileSync(join(legacyRollback.site, "previous"), "utf8").trim(), realpathSync(join(legacyRollback.site, legacy.target)));

  const emptyRollback = switchFixture(t);
  const failedInitial = releaseMeta(emptyRollback.site, "a", "EMPTY");
  linkCurrent(emptyRollback.site, failedInitial.target);
  assertSwitchBlocked(runSwitch(emptyRollback.site, "EMPTY", "EMPTY", "rollback", emptyRollback.env));
  const removed = runSwitch(emptyRollback.site, failedInitial.id, "EMPTY", "rollback", emptyRollback.env);
  assert.equal(removed.status, 0, removed.stderr);
  assert.throws(() => readlinkSync(join(emptyRollback.site, "current")), { code: "ENOENT" });
});

test("two promotions from one expected release serialize; only the first activation wins", async t => {
  const { site, env } = switchFixture(t);
  const current = releaseMeta(site, "a");
  const left = releaseMeta(site, "b", current.id);
  const right = releaseMeta(site, "c", current.id);
  linkCurrent(site, current.target);

  const launch = next => new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [releaseSwitch, site, current.id, next.id, "promote"], {
      cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => resolvePromise({ status, stdout, stderr }));
  });
  const [one, two] = await Promise.all([launch(left), launch(right)]);
  assert.equal([one.status, two.status].filter(code => code === 0).length, 1, `${one.stderr}\n${two.stderr}`);
  assert.equal([one.status, two.status].filter(code => code !== 0).length, 1);
  const active = readFileSync(join(site, "current/release-id.txt"), "utf8").trim();
  assert.ok([left.id, right.id].includes(active));
  assert.equal(readFileSync(join(site, "previous"), "utf8").trim(), realpathSync(join(site, current.target)));
});
