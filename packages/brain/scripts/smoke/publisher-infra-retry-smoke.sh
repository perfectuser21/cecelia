#!/usr/bin/env bash
# publisher-infra-retry-smoke.sh
# 真环境验收（sprint 08221235-kernel-3354cd28 —— publisher 纳入 INFRA_RETRY_ACTION_BY_ROLE）：
#   runner_failure = 基础设施故障（容器/guard/依赖装配起不来），不是产品失败。与
#   infrastructure_blocked / account_exhausted 同族——有界重派同角色（≤2 次），超限进人审。
#   本 sprint 补齐 publisher 表项，使其与 evaluator/judge/generator 语义一致。
#
# 验收 4 点（真 import real derive，不 mock 被改的边）：
#   1. derive.js 源码含 publisher 表项（phase=publish, action=ACTION.PUBLISH_APPROVED_REF）
#   2. publisher runner_failure 首次 → 返回 publish 重派动作，不再 route_unknown
#   3. 超限守恒：第 3 次 publisher runner_failure 仍进人审 exhausted
#   4. 回归守恒：evaluator runner_failure 首次仍重派 evaluator（既有角色行为不回退）
set -uo pipefail
cd "$(dirname "$0")/../../../.."

PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS + 1)); }
bad()  { echo "❌ $1"; FAIL=$((FAIL + 1)); }

# 1. 源码断言：INFRA_RETRY_ACTION_BY_ROLE 含 publisher 表项
echo "── 源码断言：derive.js INFRA_RETRY_ACTION_BY_ROLE.publisher ──"
if node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const m=c.match(/INFRA_RETRY_ACTION_BY_ROLE\s*=\s*Object\.freeze\(\{[\s\S]*?\}\)/);if(!m||!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(m[0]))process.exit(1)"; then
  ok "derive.js 含 publisher 表项（phase=publish, action=ACTION.PUBLISH_APPROVED_REF）"
else
  bad "derive.js 缺 publisher 表项"
fi

# 2/3/4. 行为断言：真 import real derive，构造真实 observed 喂进去
echo "── 行为断言：真 derive(observed) 三态 ──"
if node --input-type=module -e '
import { derive } from "./packages/brain/src/orchestrator/derive.js";
const base = (o = {}) => ({
  run: { phase: "publish" }, task: { status: "in_progress" },
  prdExists: true, contract: { approved: true }, pr: null,
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: { code: 0, auth_failed: false },
  proposeBranchRn: 1, ganLatestRoundVerdict: "APPROVED", generatorSpawned: true,
  evaluateVerdict: "PASS", judgeVerdict: "PASS", reviewRequired: false, reviewApproved: false,
  counters: { hops: 30, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
  ...o,
});
const cb = (hop, d) => ({ hop, action: "verdict:attempt_callback", detail: { hop: hop - 1, ...d } });

// 首次 publisher runner_failure → publish 重派
const first = derive(base({ decisionLog: [cb(29, { status: "failed", failure_class: "runner_failure", role: "publisher" })] }));
if (first.phase !== "publish" || first.action !== "publish:approved_ref" || first.reason !== "callback_runner_failure_retry") {
  console.error("首次重派断言失败:", JSON.stringify(first)); process.exit(1);
}
if (first.reason === "callback_runner_failure_route_unknown") { console.error("仍命中 route_unknown"); process.exit(1); }

// 超限第 3 次 → 进人审 exhausted
const third = derive(base({ decisionLog: [
  cb(21, { status: "failed", failure_class: "runner_failure", role: "publisher" }),
  { hop: 22, action: "spawn:publisher", detail: { reason: "callback_runner_failure_retry" } },
  cb(25, { status: "failed", failure_class: "runner_failure", role: "publisher" }),
  { hop: 26, action: "spawn:publisher", detail: { reason: "callback_runner_failure_retry" } },
  cb(29, { status: "failed", failure_class: "runner_failure", role: "publisher" }),
] }));
if (third.phase !== "review" || third.action !== "wait:human_review" || third.reason !== "callback_runner_failure_exhausted") {
  console.error("超限守恒断言失败:", JSON.stringify(third)); process.exit(1);
}

// 回归守恒：evaluator runner_failure 首次仍重派 evaluator
const evalr = derive(base({ run: { phase: "evaluate" }, decisionLog: [cb(29, { status: "failed", failure_class: "runner_failure", role: "evaluator" })] }));
if (evalr.phase !== "evaluate" || evalr.action !== "spawn:evaluator" || evalr.reason !== "callback_runner_failure_retry") {
  console.error("evaluator 回归守恒断言失败:", JSON.stringify(evalr)); process.exit(1);
}
console.log("derive publisher/evaluator runner_failure 三态断言全过");
'; then
  ok "真 derive：publisher 首次重派 / 超限 exhausted / evaluator 回归守恒 全过"
else
  bad "真 derive 行为断言失败"
fi

echo ""
echo "════════ publisher-infra-retry smoke: PASS=$PASS FAIL=$FAIL ════════"
[ "$FAIL" -eq 0 ] || exit 1
echo "OK: publisher-infra-retry smoke passed"
