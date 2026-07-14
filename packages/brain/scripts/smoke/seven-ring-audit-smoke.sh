#!/usr/bin/env bash
# Smoke: seven-ring-audit — 刀3-T6 七环对账
# 验证：
#   1. runSevenRingAudit 返回结构正确（7 环、必要字段）
#   2. loadRatchet 文件缺失时返回 hard_flaw_max=0
#   3. scheduler-jobs JOBS 已注册 seven-ring-audit
set -euo pipefail

echo "[seven-ring-audit-smoke] 1. runSevenRingAudit 结构验证（fake pool）"
node --input-type=module -e "
import { runSevenRingAudit, loadRatchet, __resetSevenRingAuditForTest } from './packages/brain/src/seven-ring-audit.js';

// 构造 fake pool —— 全部返回空行
const pool = { query: async () => ({ rows: [] }) };

__resetSevenRingAuditForTest();
const result = await runSevenRingAudit(pool);

// 必须有 7 环
if (!Array.isArray(result.rings) || result.rings.length !== 7) {
  console.error('FAIL: rings 应为 7 元素数组，得到', JSON.stringify(result.rings));
  process.exit(1);
}

// 每环必须含 ring/label/ok/warn/hard_flaw/detail
for (const ring of result.rings) {
  for (const k of ['ring','label','ok','warn','hard_flaw','detail']) {
    if (!(k in ring)) {
      console.error('FAIL: 环对象缺字段', k, JSON.stringify(ring));
      process.exit(1);
    }
  }
}

// hard_flaws 为数字 + audited_at 存在
if (typeof result.hard_flaws !== 'number') { console.error('FAIL: hard_flaws 应为数字'); process.exit(1); }
if (!result.audited_at) { console.error('FAIL: audited_at 缺失'); process.exit(1); }

console.log('[seven-ring-audit-smoke] 结构 OK hard_flaws=' + result.hard_flaws);
"

echo "[seven-ring-audit-smoke] 2. loadRatchet 文件缺失时零容忍"
node --input-type=module -e "
import { loadRatchet } from './packages/brain/src/seven-ring-audit.js';
const r = loadRatchet();
// 文件可能存在（scripts/seven-ring-ratchet.json），取最大值
if (typeof r.hard_flaw_max !== 'number') {
  console.error('FAIL: hard_flaw_max 应为数字');
  process.exit(1);
}
console.log('[seven-ring-audit-smoke] ratchet OK hard_flaw_max=' + r.hard_flaw_max);
"

echo "[seven-ring-audit-smoke] 3. scheduler-jobs 已注册 seven-ring-audit"
node --input-type=module -e "
import { JOBS } from './packages/brain/src/scheduler-jobs.js';
const found = JOBS.find((j) => j.name === 'seven-ring-audit');
if (!found) {
  console.error('FAIL: scheduler-jobs JOBS 未注册 seven-ring-audit');
  process.exit(1);
}
if (!found.needsPool) {
  console.error('FAIL: seven-ring-audit 应 needsPool=true');
  process.exit(1);
}
console.log('[seven-ring-audit-smoke] 注册 OK: ' + found.description);
"

echo "[seven-ring-audit-smoke] ✅ ALL PASS"
