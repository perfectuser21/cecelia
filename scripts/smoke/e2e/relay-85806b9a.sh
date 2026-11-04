#!/usr/bin/env bash
# 只读消费现役 graph API 快照；不执行扫描，不宣称本轮扫描或全链路已完成。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-${1:-}}"
: "${BRAIN_URL:?explicit BRAIN_URL is required}"
node --input-type=module - "$BRAIN_URL" <<'NODE'
import assert from 'node:assert/strict';
const base = new URL(process.argv[2]);
async function read(path, options) {
  const response = await fetch(new URL(path, base), {...options, signal: AbortSignal.timeout(10000)});
  assert.ok(response.ok, `graph HTTP ${response.status}`);
  return response.json();
}
function fresh(data, repo) {
  assert.equal(data.freshness?.repo, repo, 'graph repo mismatch');
  assert.equal(data.freshness?.status, 'fresh', 'graph snapshot is not fresh');
  assert.equal(data.freshness?.stale, false, 'graph snapshot is stale');
  assert.ok(Number.isInteger(data.freshness?.row_count) && data.freshness.row_count > 0, 'graph snapshot is empty');
}
try {
  for (const repo of ['cecelia', 'zenithjoy-workspace', 'zenithjoy-skills']) {
    const query = new URLSearchParams({q: '.', repo});
    const located = await read(`/api/brain/graph/locate?${query}`);
    fresh(located, repo);
    assert.ok(Array.isArray(located.files) && located.files.length > 0, 'graph locate has no files');
    const file = located.files[0];
    assert.ok(typeof file === 'string' && file.length > 0);
    const radius = await read('/api/brain/graph/radius', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({file, repo, max_depth: 1}),
    });
    fresh(radius, repo);
    assert.deepEqual(radius.input_files, [file], 'radius did not consume the located file');
    assert.ok(Number.isInteger(radius.reached_count) && radius.reached_count >= 1, 'radius has no reached nodes');
  }
  console.log('PASS: three nonempty fresh graph snapshots and their read-only radius queries verified; scanner execution is not asserted');
} catch (error) {
  console.error(`FAIL: graph snapshot smoke: ${error.message}`);
  process.exitCode = 1;
}
NODE
