#!/usr/bin/env bash
# orchestrator 骨架冒烟：纯函数层离线可跑（不依赖 Brain API/DB/docker）。
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── orchestrator smoke ──"

# 1. 模块可加载 + derive 对样例 observed 路由正确（terminal 短路）
node --input-type=module -e "
import { derive } from './src/orchestrator/derive.js';
const r = derive({
  run: { phase: 'done' }, task: { status: 'completed' }, contract: null,
  prdExists: true, pr: null, inflight: { containers: [], hostPids: [] },
  lastAgentExit: { code: null, auth_failed: false },
  proposeBranchRn: 0, ganLatestRoundVerdict: null, generatorSpawned: false,
  evaluateVerdict: null, judgeVerdict: null, reviewRequired: false, reviewApproved: false,
  counters: { hops: 0, fixRound: 0, ganRound: 0, noPushStreak: 0, noVerdictStreak: 0, pollCount: 0, costUsd: 0 },
});
if (r.action !== 'exit') { console.error('unexpected: ' + JSON.stringify(r)); process.exit(1); }
" && ok "derive 加载 + terminal 路由" || fail "derive 加载/路由"

# 2. mergeGate 硬门禁：无 verdict 必拒
node --input-type=module -e "
import { mergeGate } from './src/orchestrator/gates.js';
const g = mergeGate({ evaluateVerdict: null, judgeVerdict: null, prHeadSha: 'abc', reviewRequired: false, reviewApproved: false });
if (g.allow !== false) process.exit(1);
" && ok "mergeGate 无 verdict 拒合" || fail "mergeGate"

# 3. 确定性守卫：纯函数文件无时钟/随机调用
node -e "
const fs = require('fs');
for (const f of ['derive','gates','counters']) {
  const c = fs.readFileSync('src/orchestrator/' + f + '.js', 'utf8');
  if (/Date\.now\(|Math\.random\(|new Date\(/.test(c)) process.exit(1);
}
" && ok "derive/gates/counters 无非确定性调用" || fail "确定性守卫"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
