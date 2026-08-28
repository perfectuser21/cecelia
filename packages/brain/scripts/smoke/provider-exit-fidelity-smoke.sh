#!/usr/bin/env bash
# provider-exit-fidelity-smoke.sh — r79 结构化上报保真透传真验
#
# 验证 harness kernel 自驱 GAN 循环内部「执行体产出结构化终态 → 回执保真透传 + 按错误码族分流」：
#   ① 归因口径 ground-truth.GENERATOR_RUNTIME_ERROR_CODES 含 provider_*、排除 CONTRACT_* 家族
#   ② kernel derive：generator 结构化 BLOCKED + CONTRACT_* → arbitrate:contract_fault 重开 GAN
#   ③ kernel derive 负向不动：provider_exit 真崩溃 → callback_infrastructure_blocked 有界重派
#   ④ runner 归一化：真 bash + 真 jq 抽取 entrypoint.sh 的 normalize_provider_failure，
#      结构化 BLOCKED 的 CONTRACT_SELF_CONTRADICTION 保真透传，负向真崩溃仍落 provider_exit
# 纯读逻辑、离线可重放：不依赖运行中的 Brain / DB（真 import 被改模块 + 真 bash/jq 抽取原文函数）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DERIVE_URL="file://${REPO_ROOT}/packages/brain/src/orchestrator/derive.js"
GROUND_TRUTH_URL="file://${REPO_ROOT}/packages/brain/src/orchestrator/ground-truth.js"
ENTRYPOINT="${REPO_ROOT}/docker/cecelia-runner/entrypoint.sh"

command -v jq >/dev/null || { echo "FAIL: jq 不可用（被改 bash 函数的真实依赖）"; exit 1; }

echo "🔬 provider-exit-fidelity-smoke — 结构化上报保真透传（r79）"
echo "   derive:       ${DERIVE_URL}"
echo "   ground-truth: ${GROUND_TRUTH_URL}"

# ── kernel 侧：真 import derive + ground-truth ────────────────────────────────
DERIVE_URL="$DERIVE_URL" GROUND_TRUTH_URL="$GROUND_TRUTH_URL" node --input-type=module <<'NODE'
import assert from 'node:assert/strict';

const { derive } = await import(process.env.DERIVE_URL);
const groundTruth = await import(process.env.GROUND_TRUTH_URL);

// ① 归因口径：CONTRACT_* 家族不落 runtime error
const codes = groundTruth.GENERATOR_RUNTIME_ERROR_CODES;
assert.ok(codes instanceof Set, 'ground-truth.js 必须导出 GENERATOR_RUNTIME_ERROR_CODES(Set)');
assert.ok(codes.has('provider_exit'), 'Set 必须含 provider_exit');
assert.ok(codes.has('provider_timeout'), 'Set 必须含 provider_timeout');
for (const c of ['CONTRACT_SELF_CONTRADICTION', 'CONTRACT_TEST_UNSATISFIABLE', 'CONTRACT_CI_SCOPE_CONFLICT']) {
  assert.ok(!codes.has(c), `${c} 不得落 runtime error 归因`);
}

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}
const cb = (hop, detail) => ({ hop, action: 'verdict:attempt_callback', detail: { hop: hop - 1, ...detail } });

// ② CONTRACT_* → 合同故障重开 GAN
const contractFault = derive(baseObserved({
  decisionLog: [cb(29, { status: 'blocked', role: 'generator', error_code: 'CONTRACT_SELF_CONTRADICTION' })],
}));
assert.equal(contractFault.phase, 'gan', 'CONTRACT_* 应重开 GAN');
assert.equal(contractFault.action, 'arbitrate:contract_fault', 'CONTRACT_* 应走 arbitrate:contract_fault');
assert.notEqual(contractFault.action, 'mark:failed', 'CONTRACT_* 不得进 failed');

// ③ 负向不动：provider_exit 真崩溃 → infrastructure 有界重派
const infra = derive(baseObserved({
  decisionLog: [cb(29, { status: 'failed', role: 'generator', failure_class: 'infrastructure_blocked', error_code: 'provider_exit' })],
}));
assert.equal(infra.reason, 'callback_infrastructure_blocked', 'provider_exit 应走 infrastructure 有界重派');
assert.notEqual(infra.action, 'arbitrate:contract_fault', 'provider_exit 不得误判合同故障');
assert.notEqual(infra.phase, 'failed', 'provider_exit 不得直接判死');

console.log('   ✅ kernel 侧：归因口径 + CONTRACT_* 分流 + 负向不动');
NODE

# ── runner 侧：真 bash + 真 jq 抽取 entrypoint.sh 归一化函数 ──────────────────
[ -f "$ENTRYPOINT" ] || { echo "FAIL: 缺 entrypoint.sh: $ENTRYPOINT"; exit 1; }
grep -qE '^normalize_provider_failure\(\) \{' "$ENTRYPOINT" || { echo "FAIL: entrypoint.sh 未定义 normalize_provider_failure()"; exit 1; }
grep -qE '^validate_claude_terminal_receipt\(\) \{' "$ENTRYPOINT" || { echo "FAIL: entrypoint.sh 未定义 validate_claude_terminal_receipt()"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BLOCKED='{"contract_version":"1.0","attempt_id":"a1","status":"blocked","summary":"x","artifacts":[],"checks":[],"decision":null,"error":{"code":"CONTRACT_SELF_CONTRADICTION","message":"DoD 自相矛盾"}}'
printf '%s' "$BLOCKED" > "$TMP/result.json"
printf '%s' "$BLOCKED" > "$TMP/stdout.txt"

# 抽取原文函数（与冻结测试同一零件），跑 r69 结构化 BLOCKED + provider_exit=1
awk '/^normalize_provider_failure\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$ENTRYPOINT" > "$TMP/fn.sh"
{
  echo 'set -uo pipefail'
  cat "$TMP/fn.sh"
  echo 'normalize_provider_failure "$1" a1 claude "" "" false 1 "$2" "$3"'
} > "$TMP/run.sh"
bash "$TMP/run.sh" "$TMP/norm.json" "$TMP/stdout.txt" "$TMP/result.json"
NORM_CODE="$(jq -r '.error.code' "$TMP/norm.json")"
NORM_STATUS="$(jq -r '.status' "$TMP/norm.json")"
[ "$NORM_CODE" = "CONTRACT_SELF_CONTRADICTION" ] || { echo "FAIL: 结构化 BLOCKED 被埋没为 $NORM_CODE（应保真 CONTRACT_SELF_CONTRADICTION）"; exit 1; }
[ "$NORM_STATUS" = "blocked" ] || { echo "FAIL: status=$NORM_STATUS（应 blocked）"; exit 1; }

# 负向不动：真崩溃无结构化产出 → 仍 provider_exit
printf 'segfault core dumped\n' > "$TMP/crash.txt"
printf 'not-json' > "$TMP/bad.json"
bash "$TMP/run.sh" "$TMP/norm2.json" "$TMP/crash.txt" "$TMP/bad.json"
NEG_CODE="$(jq -r '.error.code' "$TMP/norm2.json")"
[ "$NEG_CODE" = "provider_exit" ] || { echo "FAIL: 真崩溃应归一 provider_exit，实得 $NEG_CODE"; exit 1; }

echo "   ✅ runner 侧：CONTRACT_* 保真透传 + 负向真崩溃归一 provider_exit"
echo "✅ provider-exit-fidelity-smoke 全绿"
