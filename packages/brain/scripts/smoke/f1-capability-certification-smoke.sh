#!/usr/bin/env bash
# f1-capability-certification-smoke.sh
# 验收：F1 Capability 可信认证闭环 fail-closed 认证闸源码不变式未退化。
# 死亡告警守护——认证闸若退化为「无脑投绿」= 静默假绿最危险；本 smoke 机检
# 读路径四前提闸 + 写路径 GP identity 绑定的关键代码锚点仍在，任一缺失即红。
# 无需真库/真服务，任何环境确定性执行；真库行为由 brain-integration 回归测试与 evaluator harness 覆盖。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RESOLVER="$REPO_ROOT/packages/brain/src/lib/map-state-resolver.js"
WRITER="$REPO_ROOT/packages/brain/src/impact-contract/assertion-receipts.js"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ $1"; FAIL=$((FAIL+1)); }

# 1. 读路径：四前提 fail-closed reason_code 锚点齐全
echo "── 读闸 reason_code 锚点 ──"
for code in gp_contract_unsigned receipt_gp_contract_unbound receipt_impact_contract_unbound step_link_unbound; do
  if node -e "process.exit(require('fs').readFileSync('$RESOLVER','utf8').includes('$code')?0:1)"; then
    ok "resolver 含 fail-closed 原因码 $code"
  else
    bad "resolver 缺 fail-closed 原因码 $code（认证闸退化风险）"
  fi
done

# 2. 读路径：认证上下文取实时 signed GP contract（非投影快照）
echo "── 读闸 signed 合同现算 ──"
if node -e "const c=require('fs').readFileSync('$RESOLVER','utf8');process.exit(c.includes('golden_path_contract_versions')&&c.includes(\"status = 'signed'\")?0:1)"; then
  ok "resolver 查实时 golden_path_contract_versions(signed)"
else
  bad "resolver 未查 signed GP contract（假绿风险）"
fi

# 3. 写路径：evaluator receipt 绑定 GP identity + 无 signed 合同拒写
echo "── 写闸 GP identity 绑定 ──"
if node -e "const c=require('fs').readFileSync('$WRITER','utf8');process.exit(c.includes('gp_contract_id')&&c.includes('gp_contract_hash')&&c.includes('signed_gp')?0:1)"; then
  ok "writer 落 gp_contract_id/gp_contract_hash（CTE signed_gp）"
else
  bad "writer 未绑定 GP identity"
fi
if node -e "const c=require('fs').readFileSync('$WRITER','utf8');process.exit(c.includes('requires a signed Golden Path contract')?0:1)"; then
  ok "writer 无 signed 合同 fail-closed 拒写"
else
  bad "writer 缺无签合同拒写守护"
fi

echo "──────────────────────────────"
echo "F1 认证闸 smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
