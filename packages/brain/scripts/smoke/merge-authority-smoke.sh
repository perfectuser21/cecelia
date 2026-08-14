#!/usr/bin/env bash
# Smoke: 合并身份闸与 AI 验收闭环 fail-closed（sprint 08131950-harness-merge-authority-r6）
# 真验四刀落地：should-auto-merge 身份闸 / derive premature_merge / evaluateMergeAuthority /
# contract-store 状态机守卫 / merge-entitlement 只读端点。纯 node + grep，零外部服务依赖。
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. should-auto-merge.sh 已改为 entitlement + fail-closed 身份闸
grep -q "merge-entitlement" .github/workflows/scripts/should-auto-merge.sh \
  || { echo "FAIL: should-auto-merge.sh 未查 merge-entitlement"; exit 1; }
grep -q "stale_head_sha" .github/workflows/scripts/should-auto-merge.sh \
  || { echo "FAIL: should-auto-merge.sh 缺 stale_head_sha 分支"; exit 1; }
echo "OK: should-auto-merge.sh entitlement + fail-closed 身份闸就位"

# 2. derive.js merged 分支含 premature_merge 守卫
grep -q "premature_merge" packages/brain/src/orchestrator/derive.js \
  || { echo "FAIL: derive.js 缺 premature_merge 守卫"; exit 1; }
echo "OK: derive.js premature_merge 守卫就位"

# 3. contract-store.js 附着状态机守卫
grep -q "invalid_attached_contract_status" packages/brain/src/orchestrator/contract-store.js \
  || { echo "FAIL: contract-store.js 缺附着状态机守卫"; exit 1; }
echo "OK: contract-store.js superseded/未知附着守卫就位"

# 4. merge-entitlement 只读端点已挂载（fail-closed 返回 entitled:false）
grep -q "'/merge-entitlement'" packages/brain/src/routes/harness.js \
  || { echo "FAIL: harness.js 未挂载 /merge-entitlement 端点"; exit 1; }
echo "OK: /api/brain/harness/merge-entitlement 端点就位"

# 5. 真跑 evaluateMergeAuthority 纯函数逻辑：fail-closed 判据
node --input-type=module -e "
import { evaluateMergeAuthority } from './packages/brain/src/orchestrator/validation-identity-policy.js';
const HEAD = 'head-sha-abc';
const pass = (sha = HEAD) => ({ verdict: 'PASS', pr_head_sha: sha });

// 双同 head PASS + brainQueryOk → allow
const allow = evaluateMergeAuthority({ evaluateReceipt: pass(), judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: true });
if (!allow.allow || allow.reason !== 'all_roles_pass') { console.error('FAIL: 合法双 PASS 未放行', allow); process.exit(1); }

// Brain 查询错误 → 拒绝，绝不 fail-open
const q = evaluateMergeAuthority({ evaluateReceipt: pass(), judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: false });
if (q.allow || q.reason !== 'brain_query_error') { console.error('FAIL: Brain 查询错误未 fail-closed', q); process.exit(1); }

// 旧 SHA receipt → 拒绝
const stale = evaluateMergeAuthority({ evaluateReceipt: pass('old'), judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: true });
if (stale.allow || stale.reason !== 'stale_evaluate_sha') { console.error('FAIL: 旧 SHA 未拒绝', stale); process.exit(1); }

// 缺 Judge → 拒绝
const noJudge = evaluateMergeAuthority({ evaluateReceipt: pass(), judgeReceipt: null, prHeadSha: HEAD, brainQueryOk: true });
if (noJudge.allow || noJudge.reason !== 'judge_receipt_missing') { console.error('FAIL: 缺 Judge 未拒绝', noJudge); process.exit(1); }

console.log('OK: evaluateMergeAuthority fail-closed 四态判据正确');
"

echo "PASS: merge-authority-smoke 全部通过"
