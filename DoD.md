contract_branch: cp-harness-propose-r1-e9e0db8f-ra12024ee-a4
sprint_dir: sprints/08211504-kernel-e9e0db8f

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性终态 fail-closed 出口（r19/r38）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 与 `structure-gate.js` 的「reason 透传 + retryable 分流」；确定性终态 fail-closed 出口（`retryable:false`）；瞬态保持 `retryable:true`；未知 reason 保守 fail-closed。**不改** loop.js（终态出口 loop.js:1661-1664 既有）、Mapper freshness 计算、全局重试上限策略。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结回归测试文件存在且含终态 fail-closed 断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js','utf8');if(!c.includes('projection_digest_mismatch')||!c.includes('retryable'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] diff-gate.js 终态分支不再对 digest/revision mismatch 硬编码 retryable:true（改由分类决定）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const m=c.match(/projection_digest_mismatch[^}]*retryable:\s*true/);if(m)process.exit(1)"
  期望: exit 0（不存在 projection_digest_mismatch 与 retryable:true 同分支硬编码）

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous / vitest oracle）

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] B-01: 确定性终态透传具体 reason_code 且 retryable=false（不折叠成 mapper_stale）
  动作: 调 evaluateDiffGate，注入 Mapper 返回稳定 projection_digest_mismatch 的确定性投影
  预期观察: 返回 {gate:'impact_unknown', reason:'projection_digest_mismatch', retryable:false}——reason 具体、终态不可重试
  等待预算: 0s
  留证: vitest --reporter=basic 输出末 5 行（含 "终态 projection_digest_mismatch" 用例 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "终态 projection_digest_mismatch" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 [fail-closed] B-02: 全部确定性终态（projection/manifest/revision digest mismatch）均 retryable=false
  动作: 调 evaluateDiffGate 分别注入稳定 manifest_digest_mismatch / revision_mismatch / projection_digest_mismatch
  预期观察: 三条终态用例 reason 各为其具体 code，retryable 全为 false
  等待预算: 0s
  留证: vitest 输出（"终态" 过滤下 3 用例 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "终态" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: 基础设施类瞬态保持 retryable=true（不被误判为终态过早 fail-closed）
  动作: 调 evaluateDiffGate 分别注入 mapper 抛错(unavailable) / freshness stale 无 reason_code / fact_revisions 缺 repo
  预期观察: reason 分别为 mapper_unavailable / mapper_stale / revision_evidence_missing，retryable 全为 true
  等待预算: 0s
  留证: vitest 输出（"瞬态" 过滤下 3 用例 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "瞬态" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-04: freshness 携带具体 reason_code 时透传该 reason（不折叠 mapper_stale）
  动作: 调 evaluateDiffGate，Mapper freshness={status:'stale', reason_code:'projection_digest_mismatch'}
  预期观察: 返回 reason='projection_digest_mismatch'（透传原始 code）、retryable=false
  等待预算: 0s
  留证: vitest 输出（"透传" 过滤用例 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "透传" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 [fail-closed] B-05: 未知/未枚举 reason_code 默认 fail-closed retryable=false 且透传原文
  动作: 调 evaluateDiffGate，Mapper freshness reason_code 为未枚举字符串 brand_new_unenumerated_reason
  预期观察: 返回 reason='brand_new_unenumerated_reason'（透传）、retryable=false（保守 fail-closed）
  等待预算: 0s
  留证: vitest 输出（"未知" 过滤用例 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "未知" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-06: structure-gate 同源折叠对齐——终态 retryable=false、瞬态 retryable=true
  动作: 调 evaluateStructureGate 分别注入 revision_mismatch(终态) / mapper_stale(瞬态) / mapper_unavailable(瞬态)
  预期观察: revision_mismatch retryable=false；mapper_stale、mapper_unavailable retryable=true
  等待预算: 0s
  留证: vitest 输出（"Structure Gate" 过滤下 3 用例 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "Structure Gate" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-4 B-07: 既有 impact-contract 回归全绿（旧测试对终态 retryable 断言同步更新后不破其他行为）
  动作: 在 packages/brain 包内跑 diff-gate + structure-gate 既有单测（用该包 vitest 配置）
  预期观察: 两文件全部用例 PASS（生成侧须把旧的「终态 retryable:true」断言更新为 false，其余行为不回退）
  等待预算: 0s
  留证: vitest 输出末 5 行（Test Files passed）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js --reporter=basic'
  期望: exit 0

## Invariant 覆盖（铁律逐条映射）

- [fail-closed] validation_clock_required 默认 fail-closed → INV-1/INV-2/INV-3 覆盖：本 sprint 的核心即扩展 fail-closed 出口（终态/未知 reason 一律 retryable=false 拒绝，绝不假绿放行 pass/extend）。
- [infra-retry-identity] Generator 基础设施失败必须重试 → N/A：本 sprint 不改 generator 重派身份；仅保证「基础设施类瞬态」reason 保持 retryable=true 供 loop.js infrastructure_blocked 重派（B-03 守护）。
- [brain-url-authority] HARNESS_BRAIN_URL 权威 → N/A：本 sprint 无 Fleet Worker / Brain URL 相关改动。
- [planner-branch] Planner workspace 停在 planner_branch → N/A：本 sprint 非 planner 角色改动。
- [judge-gate5-local_api] judge 机械闸⑤对 local_api/无 UI smoke 死锁 → 本合同验证真相形态已显式声明为「local_api 纯 vitest 单测 oracle，无 UI smoke」（见 contract-draft.md ## E2E 验收），供 judge 闸⑤放行。
- [contract-exit-code] 验证命令必须实跑确认 exit code → 已实跑：冻结测试当前 RED（exit 1，6 fail / 5 pass），修复后 exit 0；见 proposer 自查与 .brain-result.json。
- [judge-evidence-window] evaluator 一手证据排进 judge 窗口前 8 条 → 由 evaluator 阶段执行（本 proposer 阶段 N/A，合同已标注 Red→Green 时序与 exit_code 供 evaluator 引用）。

## 累积 FR 守护

- （本 line 暂无历史，无可回退行为——PRD 明示 journey e6f803f2 golden-paths 均 planned）
