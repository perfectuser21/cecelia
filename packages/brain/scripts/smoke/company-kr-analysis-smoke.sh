#!/usr/bin/env bash
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESPONSE="$(curl -q -fsS --max-time 15 "${BRAIN_URL%/}/api/brain/okr/company-key-results/analysis")"
node --input-type=module - "$RESPONSE" <<'JS'
import assert from 'node:assert/strict';
const body = JSON.parse(process.argv[2]);
assert.equal(body.success, true);
assert.equal(typeof body.config.enabled, 'boolean');
assert.ok(Number.isInteger(body.config.hour) && body.config.hour >= 0 && body.config.hour <= 23);
assert.equal(body.config.timezone, 'Asia/Shanghai');
assert.equal(body.config.agent, 'company-kr-analyst', '必须使用受限专用分析员');
if (body.latest !== null) {
  const latest = body.latest;
  assert.match(latest.id, /^[a-f\d-]{36}$/i);
  assert.ok(['queued', 'in_progress', 'paused', 'blocked', 'completed', 'completed_no_pr', 'failed', 'cancelled'].includes(latest.status));
  assert.equal(latest.input.version, 1);
  for (const key of ['snapshot_id', 'formal_hash']) assert.match(latest.input[key], /^[a-f\d]{64}$/i);
  assert.ok(Array.isArray(latest.input.items) && latest.input.items.length > 0);
  assert.equal(new Set(latest.input.items.map(item => item.id)).size, latest.input.items.length);
  for (const item of latest.input.items) assert.match(item.formal_revision, /^[a-f\d]{64}$/i);
}
console.info(`公司KR分析接口已接通：${body.config.enabled ? '启用' : '停用'}，上海时间${body.config.hour}时，执行员${body.config.agent}`);
JS
