#!/usr/bin/env bash
# Smoke: kernel-gear-dispatch — kernel 真读 gear 三档在 orchestrator 状态机内分流（sprint 08091640）
# 验证：
#   1. migration 396 给 initiative_runs 增 gear 列
#   2. kernel-run-store.createKernelRun INSERT 增写 gear
#   3. ground-truth.collectGroundTruth 注入 observed.gear
#   4. harness-skill-relay 建 run 时 deriveGear(task) 读档传入
#   5. 真跑 derive（纯函数、无 DB/无网络）：hotfix→spawn:generator、default→spawn:planner、
#      segmented→spawn:planner、turbo→mark_failed invalid_gear（真执行断言，非 grep）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "[kernel-gear-smoke] 1. migration 396 有 initiative_runs.gear 列"
ls packages/brain/migrations/396_*.sql >/dev/null 2>&1 \
  || { echo "FAIL: 缺 migration 396_*.sql"; exit 1; }
grep -qiE "ALTER TABLE +initiative_runs" packages/brain/migrations/396_*.sql \
  && grep -qi "gear" packages/brain/migrations/396_*.sql \
  || { echo "FAIL: migration 396 未给 initiative_runs 加 gear 列"; exit 1; }
echo "  ✓ migration 396 gear 列"

echo "[kernel-gear-smoke] 2. kernel-run-store / ground-truth / harness-skill-relay 接线"
node -e "
const fs = require('fs');
const grep = (f, p) => fs.readFileSync(f, 'utf8').includes(p);
const checks = [
  ['packages/brain/src/orchestrator/kernel-run-store.js', 'gear', 'createKernelRun INSERT 写 gear'],
  ['packages/brain/src/orchestrator/ground-truth.js', 'gear: run.gear', 'collectGroundTruth 注入 observed.gear'],
  ['packages/brain/src/harness-skill-relay.js', 'deriveGear(task)', 'relay 建 run 时 deriveGear 读档'],
];
const missing = checks.filter(([f, p]) => !grep(f, p));
if (missing.length) { missing.forEach(([f,,d]) => console.error('  FAIL: ' + d + ' (' + f + ')')); process.exit(1); }
console.log('  ✓ 三处接线就位');
"

echo "[kernel-gear-smoke] 3. 真跑 derive 三档分叉（纯函数真执行）"
node -e "
(async () => {
  const { derive } = await import('./packages/brain/src/orchestrator/derive.js');
  const initial = (gear) => ({
    run: { phase: 'planning' }, task: { status: 'in_progress' },
    prdExists: false, contract: { approved: false }, pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0, ganLatestRoundVerdict: null, generatorSpawned: false,
    evaluateVerdict: null, judgeVerdict: null, reviewRequired: false, reviewApproved: false,
    decisionLog: [],
    counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...(gear === undefined ? {} : { gear }),
  });
  const cases = [
    ['hotfix', d => d.phase === 'generate' && d.action === 'spawn:generator'],
    ['default', d => d.phase === 'planning' && d.action === 'spawn:planner'],
    [undefined, d => d.action === 'spawn:planner'],
    ['segmented', d => d.phase === 'planning' && d.action === 'spawn:planner'],
    ['turbo', d => d.phase === 'failed' && d.action === 'mark_failed' && d.reason === 'invalid_gear'],
  ];
  for (const [gear, ok] of cases) {
    const d = derive(initial(gear));
    if (!ok(d)) {
      console.error('  FAIL: gear=' + String(gear) + ' → ' + JSON.stringify(d));
      process.exit(1);
    }
  }
  console.log('  ✓ derive 三档分叉真执行全过（hotfix→generator / default·undefined·segmented→planner / turbo→invalid_gear）');
})().catch(e => { console.error('  FAIL:', e.message); process.exit(1); });
"

echo "[kernel-gear-smoke] ✅ PASS"
