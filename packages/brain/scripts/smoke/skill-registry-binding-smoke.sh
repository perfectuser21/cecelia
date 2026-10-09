#!/usr/bin/env bash
# Smoke: skill-registry-binding — getSkillForTaskType 改查 skill_registry（链 bf5088a3 棒7，任务 9917a588，决策 105a5868）
# 验证：
#   1. 解析纯逻辑：账本改映射→解析变化；缺映射走硬编码；两边都无返回 undefined；账本读取失败回落硬编码不抛
#   2. skill_override 最优先且不查库
#   3. 迁移 470：加列幂等 + 回填 UPSERT 不覆盖其它列 + 回滚脚本在
#   4. 接线：executor 经 resolveSkillWithLedger 解析；日报/晨报接漂移检测（缺映射 AMBER）
#   5. （可选）SKILL_BINDING_SMOKE_DB_URL 指向已跑完迁移的库：账本与硬编码零漂移
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[skill-registry-binding-smoke] 1-2. 解析纯逻辑"
node --input-type=module -e "
import { ensureSkillBindingsFresh, resolveTaskTypeSkill, resolveSkillWithLedger, detectSkillBindingDrift, renderSkillBindingLine, _resetSkillBindingCacheForTest } from './src/lib/skill-binding-registry.js';
const HARD = { dev: '/dev', review: '/code-review', research: '' };
const pool = (rows) => ({ query: async () => ({ rows }) });
const ledger = [{ name: 'code-review-gate', status: 'active', task_types: ['review'], dispatch_command: null }];
await ensureSkillBindingsFresh(pool(ledger));
if (resolveTaskTypeSkill('review', HARD) !== '/code-review-gate') { console.error('FAIL 账本改映射后解析未变化'); process.exit(1); }
if (resolveTaskTypeSkill('dev', HARD) !== '/dev') { console.error('FAIL 缺映射未走硬编码兜底'); process.exit(1); }
if (resolveTaskTypeSkill('unknown_x', HARD) !== undefined) { console.error('FAIL 两边都无应返回 undefined'); process.exit(1); }
const drift = await detectSkillBindingDrift(pool(ledger), HARD);
if (drift.missing.length !== 1 || drift.missing[0].task_type !== 'dev' || !renderSkillBindingLine(drift)?.includes('AMBER')) { console.error('FAIL 缺映射未产出 AMBER: ' + JSON.stringify(drift)); process.exit(1); }
_resetSkillBindingCacheForTest();
const down = { query: async () => { throw new Error('registry down'); } };
const s = await resolveSkillWithLedger(down, { task_type: 'review', payload: {} }, (t) => resolveTaskTypeSkill(t, HARD) || '/dev');
if (s !== '/code-review') { console.error('FAIL 账本故障未回落硬编码: ' + s); process.exit(1); }
const o = await resolveSkillWithLedger({ query: async () => { throw new Error('override 不该查库'); } }, { task_type: 'review', payload: { skill_override: '/mine' } }, () => '/x');
if (o !== '/mine') { console.error('FAIL skill_override 未最优先'); process.exit(1); }
console.log('账本优先 / 缺映射兜底+AMBER / 故障回落 / skill_override 最优先 ✓');
"

echo "[skill-registry-binding-smoke] 3. 迁移 470 结构"
node -e "
const fs = require('fs');
const up = fs.readFileSync('migrations/470_skill_registry_task_bindings.sql', 'utf8');
const must = [
  'ADD COLUMN IF NOT EXISTS task_types',
  'ADD COLUMN IF NOT EXISTS dispatch_command',
  'USING GIN (task_types)',
  'ON CONFLICT (name) DO UPDATE',
  'COALESCE(skill_registry.dispatch_command',
  \"'470'\",
];
for (const m of must) if (!up.includes(m)) { console.error('FAIL 迁移 470 缺少: ' + m); process.exit(1); }
if (!fs.existsSync('migrations/rollback/470_skill_registry_task_bindings.down.sql')) { console.error('FAIL 缺回滚脚本'); process.exit(1); }
console.log('迁移 470 幂等加列 + UPSERT + 回滚脚本 ✓');
"

echo "[skill-registry-binding-smoke] 4. 接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/executor.js', ['resolveSkillWithLedger(pool', 'resolveTaskTypeSkill(taskType, EXECUTOR_SKILL_MAP)']],
  ['src/daily-report-generator.js', ['detectSkillBindingDrift(dbPool, EXECUTOR_SKILL_MAP)', 'renderSkillBindingSection']],
  ['src/morning-cockpit-bark.js', ['fetchSkillBindingLine', 'renderSkillBindingLine']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('executor 解析 / 日报 / 晨报 全部接线 ✓');
"

if [ -n "${SKILL_BINDING_SMOKE_DB_URL:-}" ]; then
  echo "[skill-registry-binding-smoke] 5. 真库：账本与硬编码零漂移"
  node --input-type=module -e "
import pg from 'pg';
import { detectSkillBindingDrift } from './src/lib/skill-binding-registry.js';
import { EXECUTOR_SKILL_MAP } from './src/lib/task-type-registry.js';
const pool = new pg.Pool({ connectionString: process.env.SKILL_BINDING_SMOKE_DB_URL, max: 1 });
const drift = await detectSkillBindingDrift(pool, EXECUTOR_SKILL_MAP);
await pool.end();
if (!drift) { console.error('FAIL 漂移检测不可用（迁移 470 未落库？）'); process.exit(1); }
if (drift.missing.length || drift.mismatched.length || drift.conflicts.length) { console.error('FAIL 账本有漂移: ' + JSON.stringify(drift)); process.exit(1); }
console.log('真库账本与硬编码零漂移 ✓');
"
else
  echo "[skill-registry-binding-smoke] 5. 跳过真库核对（未设 SKILL_BINDING_SMOKE_DB_URL）"
fi

echo "[skill-registry-binding-smoke] PASS"
