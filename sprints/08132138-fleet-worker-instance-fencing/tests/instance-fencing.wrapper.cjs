#!/usr/bin/env node
'use strict';

/*
 * Thin executable wrapper — sprint 08132138-fleet-worker-instance-fencing.
 *
 * Single-source CI test (ground truth, all assertions live here):
 *   packages/brain/scripts/fleet-worker/instance-fencing.test.cjs
 *
 * This wrapper copies NO assertion logic. It resolves the single source and runs
 * it through the brain vitest workspace, forwarding the REAL exit code so a green
 * under sprints/** can never be a silent false green (Invariant [真验非假绿]).
 *
 * It also satisfies Kernel collectApprovedContractArtifacts: a real blob lives
 * under sprint_dir/tests while the assertions stay single-sourced under
 * packages/brain (CI single source preserved).
 *
 * Fail-closed: if the single source is missing, exit non-zero (never pass).
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const brainDir = path.join(repoRoot, 'packages', 'brain');
const relSource = path.join('scripts', 'fleet-worker', 'instance-fencing.test.cjs');
const singleSource = path.join(brainDir, relSource);

if (!fs.existsSync(singleSource)) {
  console.error('FAIL: single-source test missing: ' + singleSource);
  process.exit(1);
}

// Translate a Fleet-injected DB_URL into the discrete DB_* vars that
// packages/brain/src/db-config.js consumes, so the single source hits the real
// attempt-scoped Postgres (禁 mock 边: reconcile <-> harness_attempts is real PG).
const env = { ...process.env };
if (env.DB_URL && !env.DB_HOST) {
  try {
    const u = new URL(env.DB_URL);
    env.DB_HOST = u.hostname;
    env.DB_PORT = u.port || '5432';
    if (u.pathname && u.pathname.length > 1) {
      env.DB_NAME = decodeURIComponent(u.pathname.slice(1));
    }
    if (u.username) env.DB_USER = decodeURIComponent(u.username);
    if (u.password) env.DB_PASSWORD = decodeURIComponent(u.password);
  } catch (err) {
    console.error('FAIL: invalid DB_URL: ' + err.message);
    process.exit(1);
  }
}

const result = spawnSync('npx', ['vitest', 'run', relSource], {
  cwd: brainDir,
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error('FAIL: unable to spawn vitest: ' + result.error.message);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
