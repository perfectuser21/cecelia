---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（mapper 非 fresh 折叠点）改为透传 `freshness.reason_code` + 按 `freshness.status` 分流 retryable（unknown→false 终态 fail-closed / stale→true 瞬态）；新增回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 不再返回裸 `reason:'mapper_stale'`，改为透传 reason_code + status 分流
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const seg=c.slice(c.indexOf('3a.'),c.indexOf('3b.'));if(!seg.includes('reason_code')||!seg.includes('retryable'))process.exit(1)"

- [ ] [ARTIFACT] 包内永久回归测试文件含 reason_code 透传 / 终态 fail-closed 断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('reason_code')||!c.includes('retryable'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous / local_api）

- [ ] [BEHAVIOR] [L2] B-01: 确定性终态 unknown → fail-closed 不重试且透传 reason_code
  动作: 注入 mapper `freshness={status:'unknown',reason_code:'impact_anchor_missing'}` 调真实 evaluateDiffGate
  预期观察: 出口 gate=impact_unknown、retryable=false、reason_code=impact_anchor_missing、reason≠mapper_stale（下游 loop 归 impact_contract_invalid → BLOCKED 不重派）
  等待预算: 0s
  留证: vitest 断言输出（`确定性终态 unknown` 用例 pass）
  Test: manual:bash -c "npx vitest run --no-cache sprints/08201509-kernel-767e73b2/tests/diff-gate-reason-code.test.js -t '确定性终态 unknown'"

- [ ] [BEHAVIOR] [L2] B-02: 瞬态 stale → retryable:true 且透传具体 reason_code（非裸 mapper_stale）
  动作: 注入 mapper `freshness={status:'stale',reason_code:'fact_snapshot_stale'}` 调真实 evaluateDiffGate
  预期观察: 出口 gate=impact_unknown、retryable=true、reason_code=fact_snapshot_stale、reason≠mapper_stale
  等待预算: 0s
  留证: vitest 断言输出（`瞬态 stale` 用例 pass）
  Test: manual:bash -c "npx vitest run --no-cache sprints/08201509-kernel-767e73b2/tests/diff-gate-reason-code.test.js -t '瞬态 stale'"

- [ ] [BEHAVIOR] [L2] B-03: reason_code 缺失兜底 → 不崩溃、终态 fail-closed、reason_code=null
  动作: 注入 mapper `freshness={status:'unknown',reason_code:null}` 调真实 evaluateDiffGate
  预期观察: 出口 gate=impact_unknown、retryable=false、reason_code=null，进程不崩溃（不因缺 reason_code 抛错，也不误判 fresh）
  等待预算: 0s
  留证: vitest 断言输出（`reason_code 缺失兜底` 用例 pass）
  Test: manual:bash -c "npx vitest run --no-cache sprints/08201509-kernel-767e73b2/tests/diff-gate-reason-code.test.js -t 'reason_code 缺失兜底'"

- [ ] [BEHAVIOR] [L2] B-04: 既有 revision_mismatch 出口语义不回退（回归护栏）
  动作: 注入合同 base_revision≠mapper fact_revision（fresh）调真实 evaluateDiffGate（步骤 3b，不在改动范围）
  预期观察: 出口 gate=impact_unknown、reason=revision_mismatch、retryable=true（既有语义完全不变）
  等待预算: 0s
  留证: vitest 断言输出（`revision_mismatch 出口语义不回退` 用例 pass）
  Test: manual:bash -c "npx vitest run --no-cache sprints/08201509-kernel-767e73b2/tests/diff-gate-reason-code.test.js -t 'revision_mismatch 出口语义不回退'"

- [ ] [BEHAVIOR] [L2] B-05: 包内 diff-gate 全量单测不回退（INV [status枚举全仓grep] 护栏 — 消费既有 status 枚举，不新增值）
  动作: 在包根跑全量 diff-gate.test.js（既有 20 条 fresh/3b/drift 断言 + 新增 3a 断言）
  预期观察: 全部 pass，既有 fresh/revision/digest/drift 出口语义零回退
  等待预算: 0s
  留证: vitest 汇总输出（Test Files 1 passed）
  Test: manual:bash -c "cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js"

## Invariant 覆盖（铁律逐条映射）

- INV-1 [fail-closed] Mapper 任何不可判定 → blocked 不假绿 → B-01（unknown→gate=impact_unknown+retryable:false）、B-03（缺 reason_code 兜底 fail-closed 不误判 fresh）覆盖
- INV-2 [status枚举全仓grep] 不新增 status/reason 枚举值（分流键 = 既有三值 `freshness.status`，未硬编码新 reason_code 断言表）→ B-05 全量回归护栏覆盖
- INV-3 [retry身份] 不可自愈条件不得伪装为可重试 → B-01（终态 retryable:false）+ B-02（瞬态才 retryable:true）覆盖
- INV-4 [真环境验证] 真跑真实 evaluateDiffGate（node/vitest 执行改动后代码，非替身）→ 全 B-0N 为 L2 服务端真验
- INV-5 [多租户] N/A：本 sprint 无 tenant 数据路径（内部门禁函数分支）
- INV-6 [端点鉴权] N/A：本 sprint 无新增/改动 HTTP 端点
- INV-7 [凭据安全] N/A：本 sprint 不涉及凭据/密钥
