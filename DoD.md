contract_branch: cp-harness-propose-r1-3a0e60eb-r3f722048-a4
sprint_dir: sprints/0813-f1-capability-certification

---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: F1 Capability 可信认证闭环

**范围**: 在 Mapper 真实读路径（`packages/brain/src/lib/map-state-resolver.js`）为 F1 Capability 投影加 fail-closed 认证闸；
在 Evaluator receipt 写路径（`packages/brain/src/impact-contract/assertion-receipts.js`）补 GP identity 绑定；
读 signed GP contract identity（`packages/brain/src/golden-path-contracts.js`）。复用现有表，不新增平行认证系统。
**大小**: L

## ARTIFACT 条目

- [x] [ARTIFACT] Mapper 认证闸落在真实读路径 map-state-resolver.js（新增读 gp_contract_id/impact_contract_id + signed 合同校验）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/map-state-resolver.js','utf8');if(!(c.includes('gp_contract_id')&&c.includes('impact_contract_id')&&c.includes('golden_path_contract_versions')))process.exit(1)"

- [x] [ARTIFACT] Evaluator receipt 写路径落 gp_contract_id/gp_contract_hash 绑定
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/assertion-receipts.js','utf8');if(!(c.includes('gp_contract_id')&&c.includes('gp_contract_hash')))process.exit(1)"

- [x] [ARTIFACT] E2E oracle harness 存在（真库 fixture 全矩阵）
  Test: node -e "require('fs').accessSync('sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs')"

- [x] [ARTIFACT] 集成回归测试存在（TDD 红→绿，进 brain-integration CI）
  Test: node -e "require('fs').accessSync('sprints/0813-f1-capability-certification/tests/f1-capability-certification.integration.test.ts')"

## BEHAVIOR 条目（五行剧本，真 Postgres，target_environment=local_api）

- [x] [BEHAVIOR] [L2] B-01: 四认证前提齐备时 F1 投影 green
  动作: harness 在 throwaway scope seed 全链（signed GP contract + receipt 绑定 gp+impact identity + 当前 SHA + step-link 绑定 feature/assertion + feature 子节点绿），调用 loadMapNodeStates 读 F1 capability 态
  预期观察: F1 capability node state=green，reason=receipt_pass（子节点冒泡）
  等待预算: 0s
  留证: harness stdout「RESULT S0-happy state=green reason=receipt_pass」
  Test: manual:bash -c 'OUT=$(node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S0-happy); echo "$OUT"; echo "$OUT" | grep -q "S0-happy state=green"'

- [x] [BEHAVIOR] [L2] B-02: 无 signed GP contract 时 F1 非绿（fail-closed）
  动作: 同上 fixture 但 GP contract 置 pending_signature（无 signed 版本），其余前提不变，读 F1 态
  预期观察: F1 capability state ∈ {red,gray,unknown} 且 ≠ green，reason=gp_contract_unsigned
  等待预算: 0s
  留证: harness stdout「RESULT S1-unsigned state=<非green> reason=gp_contract_unsigned」
  Test: manual:bash -c 'OUT=$(node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S1-unsigned); echo "$OUT"; echo "$OUT" | grep -q "reason=gp_contract_unsigned" && ! echo "$OUT" | grep -q "S1-unsigned state=green"'

- [x] [BEHAVIOR] [L2] B-03: receipt 身份绑定缺失（未绑 GP identity / 未绑 Impact / 陈旧 SHA）时 F1 非绿
  动作: 逐一破坏 receipt——gp_contract_id 置 NULL / impact_contract_id 置 NULL / source_sha 改非当前，各读一次 F1 态
  预期观察: 三种破坏各令 F1 state≠green，reason 分别为 receipt_gp_contract_unbound / receipt_impact_contract_unbound / receipt_revision_mismatch
  等待预算: 0s
  留证: harness stdout 三行 RESULT（含各 reason，均非 green）
  Test: manual:bash -c 'OUT=$(node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S3-receipt-binding); echo "$OUT"; echo "$OUT" | grep -q "receipt_gp_contract_unbound" && echo "$OUT" | grep -q "receipt_impact_contract_unbound" && ! echo "$OUT" | grep -q "S3.* state=green"'

- [x] [BEHAVIOR] [L2] B-04: step link 未绑定 Feature/Assertion 时 F1 非绿
  动作: 断开 journey_step_link 的 feature_id 或 assertion_ref，读 F1 态
  预期观察: F1 state≠green，reason=step_link_unbound
  等待预算: 0s
  留证: harness stdout「RESULT S5-steplink state=<非green> reason=step_link_unbound」
  Test: manual:bash -c 'OUT=$(node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S5-steplink); echo "$OUT"; echo "$OUT" | grep -q "reason=step_link_unbound" && ! echo "$OUT" | grep -q "S5-steplink state=green"'

- [x] [BEHAVIOR] [L2] B-05: 真实 Evaluator 落 PASS receipt 时绑定 gp_contract_id（写侧 GP identity）
  动作: 集成测试用真 Postgres + 真 persistTrustedEvaluatorReceipts(db,{attempt,result}) 落一条 PASS receipt，查落库行
  预期观察: 落库 receipt 行 gp_contract_id=signed contract id 非空、gp_contract_hash 匹配 content_hash；无 signed 合同时拒写（抛 evidence 错误）
  等待预算: 0s
  留证: vitest 用例输出「evaluator writer 绑定 gp_contract_id」通过
  Test: manual:bash -c 'node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S6-evaluator-write'

- [x] [BEHAVIOR] [L2] INV-1 [validation-clock]: Evaluator 落 receipt 的身份完整性 fail-closed 不回退
  动作: harness 用缺失 impact identity 的 evaluator bundle 调 persistTrustedEvaluatorReceipts，观察是否仍拒绝
  预期观察: 仍抛 assertion_receipt_evidence_invalid（HTTP 409），不静默落无绑定 receipt；validation 身份完整性守护未被本单放宽
  等待预算: 0s
  留证: harness stdout「RESULT INV-1 rejected=true」
  Test: manual:bash -c 'OUT=$(node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=INV1-identity-failclosed); echo "$OUT"; echo "$OUT" | grep -q "INV-1 rejected=true"'

- [x] [BEHAVIOR] [L2] INV-2 [judge-evidence]: N/A — 本 sprint 不触及 Judge evidence_insufficient vs 实现缺陷分支
  动作: 认证闸只作用于 receipt 已落库后的 Mapper 投影读路径，不进入 harness-judge.js 的 evidence 区分分支
  预期观察: harness-judge.js 的 evidence_insufficient 判定代码未被本单修改（源码守护）
  等待预算: 0s
  留证: grep 源码确认 judge evidence 分支存在且未被本单删改
  Test: manual:bash -c 'node -e "const c=require(String.raw`fs`).readFileSync(String.raw`packages/brain/src/harness-judge.js`,String.raw`utf8`);process.exit(c.includes(String.raw`evidence_insufficient`)?0:1)"'
