---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js` step 3a 非 fresh 分支：透传 `freshness.reason_code` + 按 `status` 区分 `retryable`（`unknown`→false、`stale`→true）；新增永久回归测试；package.json 版本 bump。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js step 3a 分支透传 `freshness.reason_code`（不再吞没）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/freshness\.reason_code/.test(c))process.exit(1)"

- [ ] [ARTIFACT] diff-gate.js step 3a 分支按 `freshness.status` 区分可重试性（出现 unknown/status 判定，不再无条件 retryable:true）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const seg=c.slice(c.indexOf('3a. Mapper stale'),c.indexOf('步骤 3b'));if(!/unknown/.test(seg)||!/status/.test(seg))process.exit(1)"

- [ ] [ARTIFACT] 永久回归测试落入 Brain CI 家 diff-gate.test.js（含 step 3a unknown/stale 用例）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('step 3a')||!c.includes('capability_not_in_active_projection'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: unknown 确定性结论 fail-closed —— reason_code 透传 + retryable false
  动作: 注入 mock mapClient 返回 `freshness={status:'unknown',reason_code:'capability_not_in_active_projection'}`，调 evaluateDiffGate（db:null）
  预期观察: 返回 `gate==='impact_unknown'`、`reason_code==='capability_not_in_active_projection'`、`retryable===false`
  等待预算: 0s
  留证: vitest 该 -t 用例输出末 5 行（含 1 passed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "step 3a: freshness.status unknown 透传 reason_code 且 retryable false")'

- [ ] [BEHAVIOR] [L2] B-02: stale 瞬态结论 —— reason_code 透传 + retryable true
  动作: 注入 mock mapClient 返回 `freshness={status:'stale',reason_code:'fact_snapshot_stale'}`，调 evaluateDiffGate（db:null）
  预期观察: 返回 `gate==='impact_unknown'`、`reason_code==='fact_snapshot_stale'`、`retryable===true`
  等待预算: 0s
  留证: vitest 该 -t 用例输出末 5 行（含 1 passed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "step 3a: freshness.status stale 透传 reason_code 且 retryable true")'

- [ ] [BEHAVIOR] [L2] B-03: unknown 缺 reason_code 落确定性占位 —— retryable 仍 false（不回退可重试）
  动作: 注入 mock mapClient 返回 `freshness={status:'unknown'}`（无 reason_code），调 evaluateDiffGate（db:null）
  预期观察: 返回 `retryable===false`、`reason_code` 为非空确定性占位字符串（`mapper_unknown`）
  等待预算: 0s
  留证: vitest 该 -t 用例输出末 5 行（含 1 passed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "step 3a: unknown 缺 reason_code 落确定性占位且 retryable false")'

- [ ] [BEHAVIOR] [L2] B-04: diff-gate 全套回归绿 —— 既有 3b+ 分支语义不回退（fail-closed 护栏）
  动作: 从 packages/brain 子 shell 跑整份 diff-gate.test.js（含 pass/extend/drift/revision_mismatch/fail-closed 既有用例 + 本 sprint 新增 step 3a 用例）
  预期观察: 全套用例通过，无 fail；既有 `reason:'revision_mismatch'` 等分支 retryable 语义不变
  等待预算: 0s
  留证: vitest 汇总输出末 5 行（Test Files 1 passed，Tests N passed 0 failed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js)'

## Invariant 覆盖条目（PRD 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [重试身份] 确定性失败不当瞬态无限重试：unknown → retryable===false
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "step 3a: freshness.status unknown 透传 reason_code 且 retryable false")'

- [ ] [BEHAVIOR] [L2] INV-2 [确定性优先] 判据用确定性结论 status==='unknown' 而非瞬态信号：stale 仍 retryable===true，unknown 恒 false（两态区分稳定）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "step 3a: freshness.status stale 透传 reason_code 且 retryable true")'

- [ ] [BEHAVIOR] [L2] INV-3 [fail-closed] 影响门不可判定绝不假绿：非 fresh 分支 gate 恒为 impact_unknown（不放行为 pass/extend）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "step 3a: 非 fresh 分支 gate 恒为 impact_unknown")'

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 无 `force_*`/stub/假数据；被测 `evaluateDiffGate` 为真实模块真实分支执行，仅注入 mock `mapClient`（外层 Mapper 边界，PRD 明确不在范围内，与既有 diff-gate.test.js DI 手法一致）。DB 边在本分支之前返回，无需真 Postgres（postgres:false 一致）。

## DevGate（Brain 改动强制）

- [ ] [ARTIFACT] package.json 版本已 bump 且四处同步（check-version-sync 通过）
  Test: bash scripts/check-version-sync.sh
- [ ] [ARTIFACT] facts-check 通过
  Test: node scripts/facts-check.mjs
- [ ] [ARTIFACT] DoD→Test 映射通过
  Test: node packages/quality/scripts/devgate/check-dod-mapping.cjs
