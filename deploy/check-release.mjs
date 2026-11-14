#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const releasePattern = /^\d{8}T\d{6}Z-([0-9a-f]{7,40})$/;

export function checkReleaseBase({ releaseId, commitSha = '-', cwd = process.cwd() }) {
  const match = typeof releaseId === 'string' && releaseId === releaseId.trim()
    ? releaseId.match(releasePattern) : null;
  if (!match) throw new Error('Deployment blocked: invalid or missing published release ID.');
  const shortSha = match[1];
  if (commitSha !== '-' && (!/^[0-9a-f]{40}$/.test(commitSha) || !commitSha.startsWith(shortSha))) {
    throw new Error('Deployment blocked: published commit metadata does not match the release ID.');
  }
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let publishedCommit;
  try {
    publishedCommit = git('rev-parse', '--verify', '--end-of-options', `${commitSha === '-' ? shortSha : commitSha}^{commit}`);
  } catch {
    throw new Error('Deployment blocked: published commit is missing or ambiguous in local history. Fetch its history and use a branch containing that commit.');
  }
  const candidateCommit = git('rev-parse', '--verify', 'HEAD^{commit}');
  try {
    git('merge-base', '--is-ancestor', publishedCommit, candidateCommit);
  } catch {
    throw new Error(`Deployment blocked: HEAD does not include published release ${releaseId}. Update or merge the published branch before deploying.`);
  }
  return { publishedCommit, candidateCommit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3 || process.argv.length > 4) {
    console.error('Usage: node deploy/check-release.mjs RELEASE_ID [FULL_COMMIT_SHA]');
    process.exitCode = 2;
  } else {
    try {
      const result = checkReleaseBase({ releaseId: process.argv[2], commitSha: process.argv[3] ?? '-' });
      console.log(`Published commit ${result.publishedCommit} is included in HEAD ${result.candidateCommit}.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
