#!/usr/bin/env node
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DB_DEFAULTS } from '../../packages/brain/src/db-config.js';
import {
  verifyApprovedContractManifest,
} from '../../packages/brain/src/orchestrator/approved-contract-provenance.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'json') {
      args.json = true;
      continue;
    }
    args[key] = argv[index + 1];
    index += 1;
  }
  return args;
}

function asObject(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function currentHead(repoRoot) {
  return git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
}

function commitExists(repoRoot, sha) {
  try {
    // Keep the commit existence check on git cat-file -e semantics.
    git(repoRoot, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function loadApprovedManifest(dbConfig, sprintDir) {
  const pool = new pg.Pool(dbConfig ?? DB_DEFAULTS);
  try {
    const { rows } = await pool.query(
      `SELECT manifest_digest, approved_manifest, source_commit_sha, sprint_dir
         FROM initiative_contract_approvals
        WHERE sprint_dir = $1
        ORDER BY approved_at DESC, created_at DESC
        LIMIT 1`,
      [sprintDir],
    );
    return rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

export async function runApprovedContractProvenanceCheck({
  repoRoot = process.cwd(),
  sprintDir,
  manifestDigest,
  prHeadSha,
  dbConfig = DB_DEFAULTS,
  manifestLoadError = null,
}) {
  if (manifestLoadError) {
    return { ok: false, reason: 'approved_contract_manifest_unreachable' };
  }
  let row;
  try {
    row = await loadApprovedManifest(dbConfig, sprintDir);
  } catch (error) {
    return {
      ok: false,
      reason: 'approved_contract_manifest_unreachable',
      error: error.message,
    };
  }
  if (!row?.approved_manifest) {
    return { ok: false, reason: 'approved_contract_manifest_missing' };
  }
  const approvedManifest = asObject(row.approved_manifest);
  if (!approvedManifest?.manifest_digest) {
    return { ok: false, reason: 'approved_contract_manifest_missing' };
  }
  if (!manifestDigest || manifestDigest !== row.manifest_digest || manifestDigest !== approvedManifest.manifest_digest) {
    return {
      ok: false,
      reason: manifestDigest ? 'stale_manifest_digest' : 'approved_contract_manifest_digest_missing',
      manifest_digest: row.manifest_digest,
    };
  }
  if (!prHeadSha) {
    return { ok: false, reason: 'current_pr_sha_missing' };
  }
  let headSha;
  try {
    headSha = currentHead(repoRoot);
  } catch (error) {
    return { ok: false, reason: 'current_pr_sha_missing', error: error.message };
  }
  if (!commitExists(repoRoot, prHeadSha) || prHeadSha !== headSha) {
    return { ok: false, reason: 'stale_pr_head_sha', current_pr_sha: headSha };
  }
  const drift = await verifyApprovedContractManifest({
    repoRoot,
    manifest: approvedManifest,
    currentCommitSha: prHeadSha,
  });
  if (!drift.ok) {
    return {
      ...drift,
      failure_class: drift.reason === 'approved_contract_drift'
        ? 'approved_contract_drift'
        : drift.failure_class,
      route: drift.reason === 'approved_contract_drift' ? 'requires_re_gan' : undefined,
    };
  }
  return {
    ok: true,
    manifest_digest: approvedManifest.manifest_digest,
    pr_head_sha: prHeadSha,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runApprovedContractProvenanceCheck({
    repoRoot: args['repo-root'] ?? process.cwd(),
    sprintDir: args['sprint-dir'],
    manifestDigest: args['manifest-digest'],
    prHeadSha: args['pr-head-sha'],
    dbConfig: process.env.DB_URL || process.env.DATABASE_URL
      ? { connectionString: process.env.DB_URL ?? process.env.DATABASE_URL }
      : DB_DEFAULTS,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} approved-contract-provenance ${result.reason ?? 'ok'}\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
