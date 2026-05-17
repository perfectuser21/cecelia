#!/usr/bin/env bash
# Smoke: failure_type 分类路由（DSL v1.1 deny_payload + migration 264）
# 验证：
#   1. Brain 健康
#   2. migration 264_failure_type_dispatch_constraint.sql 存在且把 6a569a1e 物化为 deny_payload
#   3. insight-constraints.js 接受 deny_payload schema 并能 evaluate 命中
#   4. selfcheck.js EXPECTED_SCHEMA_VERSION ≥ 264
#   5. （DB 可达时）learning 6a569a1e 的 dispatch_constraint 已写入
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
LEARNING_ID="6a569a1e-83c4-4052-a05a-59b2a09840a8"

echo "[failure-type-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[failure-type-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[failure-type-smoke] Brain 健康 ✓"

echo "[failure-type-smoke] 2. 验证 migration 264 存在且物化 6a569a1e 为 deny_payload"
node -e "
const fs = require('fs');
const path = 'packages/brain/migrations/264_failure_type_dispatch_constraint.sql';
if (!fs.existsSync(path)) { console.error('FAIL: migration 264 不存在'); process.exit(1); }
const sql = fs.readFileSync(path, 'utf8');
if (!sql.includes('${LEARNING_ID}')) { console.error('FAIL: migration 未引用 learning_id ${LEARNING_ID}'); process.exit(1); }
if (!sql.includes('deny_payload')) { console.error('FAIL: migration 未写入 deny_payload 规则'); process.exit(1); }
if (!sql.includes('previous_failure.class')) { console.error('FAIL: migration 未引用 previous_failure.class'); process.exit(1); }
for (const v of ['auth', 'resource', 'env_broken', 'unknown']) {
  if (!sql.includes(v)) { console.error('FAIL: migration 缺少失败类:', v); process.exit(1); }
}
console.log('migration 264 物化 6a569a1e 为 deny_payload ✓');
"

echo "[failure-type-smoke] 3. 验证 insight-constraints.js 支持 deny_payload"
node --input-type=module -e "
import { isValidConstraint, evaluateConstraints } from './packages/brain/src/insight-constraints.js';
const c = { rule: 'deny_payload', key: 'previous_failure.class', values: ['auth', 'env_broken'], reason: 'r', severity: 'block' };
if (!isValidConstraint(c)) { console.error('FAIL: deny_payload schema 校验失败'); process.exit(1); }
const blocked = evaluateConstraints({ payload: { previous_failure: { class: 'env_broken' } } }, [{ learning_id: 'x'.repeat(36), title: 't', constraint: c }]);
if (blocked.issues.length !== 1) { console.error('FAIL: env_broken 应被 block，实际 issues=' + JSON.stringify(blocked.issues)); process.exit(1); }
const passed = evaluateConstraints({ payload: { previous_failure: { class: 'transient' } } }, [{ learning_id: 'x'.repeat(36), title: 't', constraint: c }]);
if (passed.issues.length !== 0) { console.error('FAIL: transient 应通过，实际 issues=' + JSON.stringify(passed.issues)); process.exit(1); }
console.log('deny_payload schema + evaluator 行为正确 ✓');
"

echo "[failure-type-smoke] 4. 验证 selfcheck.js EXPECTED_SCHEMA_VERSION ≥ 264"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/selfcheck.js', 'utf8');
const m = src.match(/EXPECTED_SCHEMA_VERSION\s*=\s*'(\d+)'/);
if (!m) { console.error('FAIL: 未找到 EXPECTED_SCHEMA_VERSION'); process.exit(1); }
if (parseInt(m[1]) < 264) { console.error('FAIL: EXPECTED_SCHEMA_VERSION = ' + m[1] + ' 未升至 ≥264'); process.exit(1); }
console.log('selfcheck EXPECTED_SCHEMA_VERSION = ' + m[1] + ' ✓');
"

echo "[failure-type-smoke] 5. （可选）通过 Brain API 验证 6a569a1e 已激活 dispatch_constraint"
HIT=$(curl -sf "${BRAIN_URL}/api/brain/memory/search" -X POST -H "Content-Type: application/json" \
  -d "{\"query\":\"failure_type 分类路由\",\"limit\":3}" 2>/dev/null \
  | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8') || '{}');
const arr = Array.isArray(d) ? d : (d.results || d.rows || []);
const hit = arr.find(r => (r.id || r.learning_id) === '${LEARNING_ID}');
if (hit && hit.dispatch_constraint) console.log('activated');
else if (hit) console.log('found_but_not_activated');
else console.log('not_indexed');
" 2>/dev/null || echo "api_unavailable")
case "$HIT" in
  activated) echo "[failure-type-smoke] 6a569a1e dispatch_constraint 已激活 ✓" ;;
  found_but_not_activated) echo "[failure-type-smoke] WARN: 6a569a1e 存在但 dispatch_constraint 为空（migration 未跑？）" ;;
  *) echo "[failure-type-smoke] SKIP: API 未返回索引（${HIT}），跳过 DB 物化校验" ;;
esac

echo "[failure-type-smoke] 全部检查通过 ✓"
