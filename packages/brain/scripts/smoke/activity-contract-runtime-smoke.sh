#!/usr/bin/env bash
set -euo pipefail
TASK_BRAIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$TASK_BRAIN_DIR"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const cwd = mkdtempSync(join(tmpdir(), 'activity-contract-smoke-'));
try {
  copyFileSync('src/orchestrator/__tests__/fixtures/activity-runtime/activity.mjs', join(cwd, 'activity.mjs'));
  const failure = { empty_ok: [], retryable: ['transient'], fatal: ['invalid'], needs_human: { cases: [] } };
  const make = (key, order, phase = 'batch_end') => ({ key, order, failure,
    budget: { max_duration_s: 5, heartbeat_s: 1 }, runtime: { protocol: 'json-stdio-v1',
      entry: 'activity.mjs', argv: [key], phase, on_failure: 'continue' } });
  const request = { contract: { workflow: 'offline-smoke', activities: [make('partial', 1), make('deliver', 2), make('finalize', 3, 'finalize')] },
    input: { run_tag: 'offline-smoke', trace: join(cwd, 'trace'), fragments: [] } };
  const receipt = join(cwd, 'receipt.json');
  const child = spawnSync(process.execPath, [resolve('scripts/activity-contract-run.js'), '--cwd', cwd, '--receipt', receipt],
    { input: JSON.stringify(request), encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 2, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.outputs.delivered, [{ id: 'retained', owner: 'partial' }]);
  assert.equal(result.outputs.cleanup, true);
  assert.equal(result.metrics.deliver.delivered, 1);
  assert.equal(result.evidence.length, 3);
  assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), result);
  console.log('PASS 实际活动子进程：partial产物经配送保留、收尾执行、JSON回执读回一致');
} finally { rmSync(cwd, { recursive: true, force: true }); }
NODE
