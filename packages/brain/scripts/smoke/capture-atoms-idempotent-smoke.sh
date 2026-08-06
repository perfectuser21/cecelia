#!/usr/bin/env bash
# capture-atoms-idempotent-smoke.sh
# 验证 capture_atoms 幂等修复（migration 390 + ON CONFLICT DO NOTHING）
# 环境：local_api（需 DATABASE_URL 和可连接的 Brain DB）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TEST_DEDUPE_KEY="smoke:capture-atoms-idempotent:$(date +%s)"

echo "=== capture-atoms-idempotent smoke ==="
echo "Brain URL: $BRAIN_URL"
echo "Dedupe key: $TEST_DEDUPE_KEY"

# 1. Brain 存活
echo "[1/4] Brain healthz..."
curl -sf "$BRAIN_URL/healthz" -o /dev/null || { echo "FAIL: Brain 不可达"; exit 1; }
echo "PASS: Brain 存活"

# 2. 验证 capture_atoms 表有 UNIQUE 约束（schema_version >= 390）
echo "[2/4] schema_version 验证..."
VERSION=$(psql "${DATABASE_URL}" -t -c "SELECT version FROM schema_version WHERE version='390';" 2>/dev/null | tr -d ' \n')
if [ "$VERSION" != "390" ]; then
  echo "FAIL: schema_version 390 不存在（migration 390 未执行）"
  exit 1
fi
echo "PASS: schema_version 390 已执行"

# 3. 调用 pushCapture 两次，验证 capture_atoms 只有一条记录
echo "[3/4] 幂等写入验证（node）..."
node --input-type=module <<NODEJS
import { createPool } from '/workspace/packages/brain/src/db.js';
import { pushCapture } from '/workspace/packages/brain/src/capture-inbox.js';
const pool = createPool();
const args = {
  content: 'smoke-idempotent-test',
  source: 'smoke',
  dedupeKey: '${TEST_DEDUPE_KEY}',
  targetType: 'notes',
  targetSubtype: 'smoke',
};
const r1 = await pushCapture(pool, args);
console.log('r1:', JSON.stringify(r1));
if (!r1?.captureId) { console.error('FAIL: r1.captureId 为空'); process.exit(1); }
const r2 = await pushCapture(pool, args);
console.log('r2:', JSON.stringify(r2));
if (r2?.atomId !== null && r2?.atomId !== undefined) {
  console.error('FAIL: 二次写入 atomId 应为 null，实际:', r2?.atomId);
  process.exit(1);
}
await pool.end();
console.log('PASS: 幂等写入验证通过');
NODEJS

# 4. 数据库确认 atom 只有一条
echo "[4/4] DB 记录数量验证..."
COUNT=$(psql "${DATABASE_URL}" -t -c "
  SELECT COUNT(*) FROM capture_atoms ca
  JOIN captures c ON c.id = ca.capture_id
  WHERE c.dedupe_key = '${TEST_DEDUPE_KEY}';
" 2>/dev/null | tr -d ' \n')
if [ "$COUNT" != "1" ]; then
  echo "FAIL: capture_atoms 行数应为 1，实际: $COUNT"
  exit 1
fi
echo "PASS: DB 只有 1 条 atom（幂等生效）"

echo ""
echo "=== capture-atoms-idempotent smoke PASS ==="
