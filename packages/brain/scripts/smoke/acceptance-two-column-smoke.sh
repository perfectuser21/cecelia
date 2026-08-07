#!/usr/bin/env bash
# Smoke: acceptance-two-column — 验收一体两面 D1 数据层五件套（GP 7790f728，决策 fdeb48aa）
# 1. migration 392 结构件齐全（AI 四列/detail/9 值 CHECK/UNIQUE(run_id,check_key)）
# 2. 状态机与格级判定分离（computeRunStatus 不产 failed；computeCellState/GateVerdict 存在）
# 3. AI 回写端点只写 AI 列 + reason 域校验（scenario_not_triggered 合法域空集）
# 4. 建单生成器排除集（na ∪ fixedNa）+ 规程路径走 env 不回落本机路径
# 5. 收单闸/冻结锁/复盘闭环三闸挂载
set -euo pipefail

echo "[acceptance-two-column-smoke] 1. migration 392 结构件"
node -e "
const fs = require('fs');
const mig = fs.readFileSync('packages/brain/migrations/392_acceptance_two_column.sql', 'utf8');
for (const col of ['ai_verdict', 'ai_evidence', 'ai_run_at', 'adjudication']) {
  if (!mig.includes(col)) { console.error('FAIL: migration 缺 ' + col); process.exit(1); }
}
if (!mig.includes('uq_acceptance_checks_run_key')) { console.error('FAIL: 缺 UNIQUE(run_id, check_key)'); process.exit(1); }
for (const s of ['human_complete', 'adjudicated', 'stale', 'expired', 'abandoned']) {
  if (!mig.includes(s)) { console.error('FAIL: status CHECK 缺 ' + s); process.exit(1); }
}
const down = fs.readFileSync('packages/brain/migrations/rollback/392_acceptance_two_column.down.sql', 'utf8');
if (!down.includes('RAISE EXCEPTION')) { console.error('FAIL: down 缺 fail-fast 守卫'); process.exit(1); }
console.log('migration 392 结构件 ✓');
"

echo "[acceptance-two-column-smoke] 2. 状态机与格级判定分离"
node --input-type=module -e "
import { computeRunStatus, computeCellState, computeGateVerdict, computeAiStatus } from './packages/brain/src/acceptance-state.js';
// A10⑤：人列不通过不落 failed
const s = computeRunStatus('in_review', { total: 1, pending: 0, pass: 0, fail: 1 });
if (s !== 'human_complete') { console.error('FAIL: 人列不通过落了 ' + s + '（应 human_complete）'); process.exit(1); }
// ai_incomplete 是独立短路：格级全绿也拦（v7:275 静默放行口）
const g = computeGateVerdict([{ check_key: 'S1-c1', hard: false, final_state: '绿' }], { ai_incomplete: true });
if (g.gate_verdict !== '红' || g.blocked_reason !== 'ai_run_infra_error') {
  console.error('FAIL: ai_incomplete 未独立拦截'); process.exit(1);
}
console.log('状态机/格级判定分离 ✓');
"

echo "[acceptance-two-column-smoke] 3. AI 回写只写 AI 列 + reason 域"
node -e "
const fs = require('fs');
const ai = fs.readFileSync('packages/brain/src/routes/acceptance-ai.js', 'utf8');
if (!/reason_domain_empty/.test(ai)) { console.error('FAIL: 缺 scenario_not_triggered 空域拒收'); process.exit(1); }
if (/SET[\s\S]{0,200}?submitted_by/.test(ai)) { console.error('FAIL: AI 回写 UPDATE 疑似触碰人列字段'); process.exit(1); }
if (!ai.includes('mandatory_scenarios_missing')) { console.error('FAIL: 缺收单推进闸'); process.exit(1); }
console.log('AI 回写边界/收单闸 ✓');
"

echo "[acceptance-two-column-smoke] 4. 生成器排除集与规程路径纪律"
node -e "
const fs = require('fs');
const spec = fs.readFileSync('packages/brain/src/acceptance-spec.js', 'utf8');
if (!spec.includes('fixedNa')) { console.error('FAIL: 生成器缺 fixedNa 排除'); process.exit(1); }
if (!spec.includes('ACCEPTANCE_SPEC_PATH')) { console.error('FAIL: 服务端规程路径未走 env'); process.exit(1); }
const ai = fs.readFileSync('packages/brain/src/routes/acceptance-ai.js', 'utf8');
if (ai.includes('DEFAULT_SPEC_PATH')) { console.error('FAIL: 服务端回落到了本机绝对路径'); process.exit(1); }
console.log('排除集/env 纪律 ✓');
"

echo "[acceptance-two-column-smoke] 5. 三闸挂载"
node -e "
const fs = require('fs');
const routes = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
if (!routes.includes('checkCreateGate')) { console.error('FAIL: 建单前置闸未挂载'); process.exit(1); }
if (!routes.includes('checkFrozenStamps')) { console.error('FAIL: 冻结锁未挂载'); process.exit(1); }
if (!routes.includes('registerReviewClosureRoutes')) { console.error('FAIL: 复盘闭环端点未挂载'); process.exit(1); }
console.log('三闸挂载 ✓');
"

echo "[acceptance-two-column-smoke] ✅ 全部通过"
