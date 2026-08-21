#!/usr/bin/env bash
# diff-gate-reason-code-smoke.sh
# 验收（r41 sprint 08220132-kernel-d133c55c）：Diff Impact Gate 第 3a 步透传 Mapper
# freshness.reason_code 并按「瞬时白名单 vs 确定性/未知码」分类 retryable，确定性码
# fail-closed（retryable:false），gateReceipt 透传具体码（非裸 mapper_stale）。
#
# 本改动是 Brain 内部纯内存裁决函数（无 HTTP 端点），故 smoke 以 node 真调
# evaluateDiffGate / gateReceipt 做行为验收，并附带 Brain 健康探针确认真环境在线。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# 1. 真环境探针：Brain 健康端点（确认 smoke 跑在真机而非空跑）
echo "── brain health ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/context" 2>/dev/null || echo "000")
[[ "$code" == "200" || "$code" == "404" ]] \
  && ok "Brain API 可达（$API/context → $code）" \
  || fail "Brain API 不可达（$API/context → $code）"

# 2. 核心验收：node 真调 evaluateDiffGate + gateReceipt 覆盖 5 类分类 + 透传
echo "── diff-gate 3a reason_code 分类 ──"
if node --input-type=module - <<'NODE'
const cwd = process.cwd();
const gm = await import("file://" + cwd + "/packages/brain/src/impact-contract/diff-gate.js");
const hm = await import("file://" + cwd + "/packages/brain/src/impact-contract/harness-gates.js");
const call = (reason_code, miss = false) => gm.evaluateDiffGate({
  db: null, taskId: "smoke", headRevision: "head", changedFiles: [],
  mapClient: async () => miss ? ({ affected_nodes: [] }) : ({ freshness: { status: "stale", reason_code } }),
});
let fail = 0;
const check = (n, c, g) => { if (!c) { console.error("  FAIL:", n, JSON.stringify(g)); fail++; } };
let r = await call("capability_not_in_active_projection");
check("确定性码 fail-closed", r.reason === "capability_not_in_active_projection" && r.retryable === false, r);
r = await call("fact_snapshot_stale");
check("瞬时 fact_snapshot_stale 重试", r.reason === "fact_snapshot_stale" && r.retryable === true, r);
r = await call("projection_revision_missing");
check("瞬时 projection_revision_missing 重试", r.reason === "projection_revision_missing" && r.retryable === true, r);
r = await call(null, true);
check("freshness 缺失 重试", r.gate === "impact_unknown" && r.retryable === true, r);
r = await call("some_future_unknown_code");
check("未知码 fail-closed", r.retryable === false && r.reason === "some_future_unknown_code", r);
const rc = hm.gateReceipt("diff", { gate: "impact_unknown", reason: "capability_not_in_active_projection", retryable: false });
check("gateReceipt 透传具体码", rc.reason === "capability_not_in_active_projection" && rc.reason !== "mapper_stale", rc);
process.exit(fail ? 1 : 0);
NODE
then
  ok "evaluateDiffGate 5 类分类 + gateReceipt 透传全过"
else
  fail "evaluateDiffGate/gateReceipt 行为不符合合同"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
