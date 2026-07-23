#!/usr/bin/env bash
# kernel-bounded-runtime-smoke.sh
# 验证 Kernel 有界运行与正确恢复（Sprint 1b997ed6）核心能力
# 检查：watchdog/constants/derive 导出正常 + Brain 健康端点可达
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── kernel-bounded-runtime smoke ──"

# 1. Brain 健康检查（Brain 不可达时跳过，不计失败）
if curl -sf "$BRAIN/health" >/dev/null 2>&1; then
  ok "Brain /health 可达 ($BRAIN)"
else
  echo "  ⏭ Brain 不可达（$BRAIN），跳过 API 检查"
fi

# 2. 验证 watchdog.js 关键导出（watchdogShouldResume 返回 false 对 null run）
WATCHDOG_CHECK=$(node --input-type=module <<'EOF' 2>&1
import { watchdogShouldResume, watchdogAction } from '/workspace/packages/brain/src/orchestrator/watchdog.js';
const r1 = watchdogShouldResume(null);
const r2 = watchdogShouldResume({ phase: 'generate', terminal_reason: null });
const r3 = watchdogAction({ phase: 'failed', terminal_reason: 'automation_deadline_exceeded' }, null);
if (r1 !== false) throw new Error('null run should return false');
if (r2 !== true) throw new Error('active run should return true');
if (r3.action !== 'fenced_terminal_cleanup') throw new Error('expired run action wrong: ' + r3.action);
console.log('ok');
EOF
)
echo "$WATCHDOG_CHECK" | grep -q "^ok$" && ok "watchdog 导出：watchdogShouldResume / watchdogAction" || fail "watchdog 导出异常: $WATCHDOG_CHECK"

# 3. 验证 constants.js PHASE_BUDGETS_MS（generate_fix = 45 分钟）
CONST_CHECK=$(node --input-type=module <<'EOF' 2>&1
import { PHASE_BUDGETS_MS } from '/workspace/packages/brain/src/orchestrator/constants.js';
const expected = 45 * 60 * 1000;
if (PHASE_BUDGETS_MS.generate_fix !== expected) throw new Error('generate_fix budget wrong: ' + PHASE_BUDGETS_MS.generate_fix);
const total = Object.values(PHASE_BUDGETS_MS).reduce((s, v) => s + v, 0);
if (total !== 120 * 60 * 1000) throw new Error('total budget not 120min: ' + total);
console.log('ok');
EOF
)
echo "$CONST_CHECK" | grep -q "^ok$" && ok "PHASE_BUDGETS_MS: generate_fix=45min, total=120min" || fail "PHASE_BUDGETS_MS 异常: $CONST_CHECK"

# 4. 验证 derive.js 对 noProgressSameSha=true 输出 mark_failed
DERIVE_CHECK=$(node --input-type=module <<'EOF' 2>&1
import { derive } from '/workspace/packages/brain/src/orchestrator/derive.js';
const observed = {
  run: { phase: 'generate' },
  task: { status: 'in_progress' },
  prdExists: true,
  contract: { approved: true },
  pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha1' },
  inflight: { containers: [], host_pids: [] },
  lastAgentExit: { code: 0, auth_failed: false },
  proposeBranchRn: 0,
  ganLatestRoundVerdict: null,
  generatorSpawned: true,
  evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha1' },
  judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha1', failure_class: 'product_failure' },
  reviewRequired: false,
  reviewApproved: false,
  noProgressSameSha: true,
  generatorFixTriggerSha: 'sha1',
  generatorFixCompletedSha: 'sha1',
  counters: { hops: 58, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
};
const r = derive(observed);
if (r.action !== 'mark_failed') throw new Error('expected mark_failed, got: ' + r.action);
if (!r.reason || !r.reason.includes('no_progress_same_sha')) throw new Error('reason wrong: ' + r.reason);
console.log('ok');
EOF
)
echo "$DERIVE_CHECK" | grep -q "^ok$" && ok "derive: noProgressSameSha → mark_failed(no_progress_same_sha)" || fail "derive 回归: $DERIVE_CHECK"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
