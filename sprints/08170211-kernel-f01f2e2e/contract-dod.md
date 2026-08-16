---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口（r8）

**范围**: `packages/brain/src/impact-contract/diff-gate.js`（三分类）、`harness-gates.js`（gateReceipt 透传 detail）、`orchestrator/loop.js`（DETERMINISTIC_IMPACT_ERROR_CODES 补集 + 不退避）、`orchestrator/derive.js`（routeDeterministicImpact 路由）；Brain semver 四处同步；DevGate 三项。
**大小**: M
**边界**: 不改 `radius.js` / `map-client.js`；不放宽无主文件/断言覆盖规则；不给 G1 补断言。

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同冻结测试落 sprints/<sprint_dir>/tests/（r2 硬要求）
  Test: node -e "const fs=require('fs');['sprints/08170211-kernel-f01f2e2e/tests/diff-gate-reason-code.test.ts','sprints/08170211-kernel-f01f2e2e/tests/harness-gates-receipt.test.ts','sprints/08170211-kernel-f01f2e2e/tests/impact-route.test.ts','sprints/08170211-kernel-f01f2e2e/tests/fixtures/run-d1360a48-radius.json'].forEach(p=>fs.accessSync(p))"

- [ ] [ARTIFACT] diff-gate.js 含 fail-closed 出口标识 mapper_contract_invalid（(c) 分支）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('mapper_contract_invalid'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 按 reason_code 三分类 + run d1360a48 回归夹具
  动作: 跑 diff-gate-reason-code.test.ts（真实 evaluateDiffGate，注入 mapper 响应；radius 属外层边界不改）
  预期观察: 7 用例全过——impact_anchor_missing/coverage 判 blocked+retryable:false+detail；fact_snapshot_stale/manifest_projection_mismatch 仍 mapper_stale+retryable:true（回归守卫）；未知 reason 判 mapper_contract_invalid+retryable:false
  等待预算: 120s（超时=FAIL）
  留证: vitest 输出末 12 行（含 Test Files 汇总）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08170211-kernel-f01f2e2e/tests/diff-gate-reason-code.test.ts --config vitest.config.js --reporter=basic 2>&1); E=$?; printf "%s\n" "$O" | tail -12; printf "%s" "$O" | grep -q "No test files found" && { echo "FALSE-GREEN-GUARD: no test files"; exit 1; }; printf "%s" "$O" | grep -Eq "Test Files.*[0-9]+ (passed|failed)" || { echo "FALSE-GREEN-GUARD: no summary"; exit 1; }; [ $E -eq 0 ] || { echo "FAIL exit=$E"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: harness-gates beforeEvaluate gateReceipt 透传 reason/retryable/detail
  动作: 跑 harness-gates-receipt.test.ts（真实 createHarnessImpactGates + beforeEvaluate）
  预期观察: 2 用例全过——blocked 结果的 receipt 含 reason=impact_anchor_missing/capability_assertion_coverage_missing、retryable:false、detail.unclaimed_files / detail.capability_ids
  等待预算: 120s（超时=FAIL）
  留证: vitest 输出末 12 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08170211-kernel-f01f2e2e/tests/harness-gates-receipt.test.ts --config vitest.config.js --reporter=basic 2>&1); E=$?; printf "%s\n" "$O" | tail -12; printf "%s" "$O" | grep -q "No test files found" && { echo "FALSE-GREEN-GUARD: no test files"; exit 1; }; printf "%s" "$O" | grep -Eq "Test Files.*[0-9]+ (passed|failed)" || { echo "FALSE-GREEN-GUARD: no summary"; exit 1; }; [ $E -eq 0 ] || { echo "FAIL exit=$E"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: loop DETERMINISTIC 集合补集 + derive.routeDeterministicImpact 路由
  动作: 跑 impact-route.test.ts（真实 loop.js 导出 Set + 真实 derive 纯函数）
  预期观察: 5 用例全过——DETERMINISTIC_IMPACT_ERROR_CODES 含 5 个确定性 reason；impact_anchor_missing 首次→spawn:generator-fix（detail 带 unclaimed_files），已重试/coverage/其余确定性 reason→wait:human_review
  等待预算: 120s（超时=FAIL）
  留证: vitest 输出末 12 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08170211-kernel-f01f2e2e/tests/impact-route.test.ts --config vitest.config.js --reporter=basic 2>&1); E=$?; printf "%s\n" "$O" | tail -12; printf "%s" "$O" | grep -q "No test files found" && { echo "FALSE-GREEN-GUARD: no test files"; exit 1; }; printf "%s" "$O" | grep -Eq "Test Files.*[0-9]+ (passed|failed)" || { echo "FALSE-GREEN-GUARD: no summary"; exit 1; }; [ $E -eq 0 ] || { echo "FAIL exit=$E"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: 回归夹具 run d1360a48（含仓库根 DoD.md）旧 mapper_stale / 新 blocked:impact_anchor_missing
  动作: 用 -t 过滤只跑 diff-gate-reason-code.test.ts 的回归夹具用例
  预期观察: 该用例过——录制 radius 件（unclaimed_files=['DoD.md']）经新代码判 blocked/impact_anchor_missing/retryable:false/detail.unclaimed_files=['DoD.md']
  等待预算: 120s（超时=FAIL）
  留证: vitest 输出末 12 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08170211-kernel-f01f2e2e/tests/diff-gate-reason-code.test.ts -t "回归夹具 run d1360a48" --config vitest.config.js --reporter=basic 2>&1); E=$?; printf "%s\n" "$O" | tail -12; printf "%s" "$O" | grep -q "No test files found" && { echo "FALSE-GREEN-GUARD: no test files"; exit 1; }; printf "%s" "$O" | grep -Eq "Test Files.*[0-9]+ (passed|failed)" || { echo "FALSE-GREEN-GUARD: no summary"; exit 1; }; [ $E -eq 0 ] || { echo "FAIL exit=$E"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-05: 确定性结论落 orchestrator_decision_log（真 Postgres 数据写入类）[接缝×2]
  动作: 对 scratch 库（${DB_URL}）跑 E2E 助手：真实 diff-gate+harness-gates 产出确定性结论→真实 appendHop 写 orchestrator_decision_log→回读
  预期观察: 决策日志新增 1 行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.detail.unclaimed_files 非空
  等待预算: 120s（超时=FAIL）
  留证: node 助手 stdout（OK: ... unclaimed_files=[...]）；${SPRINT_DIR} E2E 脚本另跑 psql 定点复核
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; node sprints/08170211-kernel-f01f2e2e/tests/e2e/impact-decision-log.mjs'
  期望: OK: orchestrator_decision_log 落行 ...

## Invariant 覆盖（铁律映射 — 逐条）

| 铁律 | 处置 |
|------|------|
| [单slot串行] | N/A：不改调度并发模型 |
| [禁写死环境] | 覆盖（B-01..B-05）：无写死坐标/阈值；SHA/reason 均从输入或 radius 枚举推导 |
| [真环境验证] | 覆盖（B-05 真 Postgres 写读；B-01/B-04 真实 diff-gate 分类不 mock 被改边） |
| [多租户] | N/A：kernel 编排层无租户业务数据 |
| [凭据安全] | N/A：本单无凭据 |
| [日志脱敏] | 覆盖：决策日志 detail 仅含 reason/unclaimed_files/capability_ids，无敏感字段 |
| [端点鉴权] | N/A：无新增端点 |
| [租户隔离] | N/A：无租户数据 |
| [枚举全仓grep] | 覆盖：B-03 断言 DETERMINISTIC 集合字面；实现须全仓 grep 核对 radius reason_code 与 loop/derive 分类集合一致 |
| [exit语义实跑] | 覆盖：每条 B Test 带 false-green 双守卫（No test files found + Test Files 汇总），显式核验 sprints/** exit 语义（c906dd6c） |
| [local_api判定死锁] | 覆盖：## E2E 验收 段显式声明验证口径为 DB 写入回读（a0bac43b） |
| [judge结果结构] | N/A：本单不改 judge result 结构（evaluator/judge 侧义务） |
| [Red精确add] | 覆盖：Red commit 只 add sprints/08170211-kernel-f01f2e2e/tests/**（*.test.* + fixtures + e2e 助手），禁 git add . |
