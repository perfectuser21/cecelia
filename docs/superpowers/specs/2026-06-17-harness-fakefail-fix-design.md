# 设计：harness run 假摔修复（verdict 解耦 merge + 非空 reason + reportNode 自合）

> 2026-06-17。来源 Bug PrepPRD `sprints/06172042-harness-fakefail-automerge-fix/prep-prd.md` + systematic-debugging Phase 1 + Research Subagent 代码取证。

## 问题（根因已确证）
`packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode：
- 行 1424-1426：`computedVerdict = state.final_e2e_verdict || (sub_tasks 全 merged ? 'PASS' : 'FAIL')`。`final_e2e_verdict` 全仓**无任何节点写入、恒 null**，故 verdict 永远由"PR 是否 merged"推导 —— 把"PR 合没合"冒充"Final E2E 过没过"。
- 行 1446：`reason = \`Final E2E ${verdict}: ${failed_scenarios.map(s=>s.name).join('; ')}\``。`failed_scenarios=[]` 时 → 空串 `"Final E2E FAIL: "`。
- 行 1450-1467：FAIL → initiative_runs.phase='failed' + tasks.status='failed' + error_message=空 reason。

后果：evaluator 已 PASS、CI 全绿，但 PR 因 CI auto-merge 抽风未合 → run 假摔为空 reason failed，需人肉合并 + 改状态。实证 #3391 #3392。

## 设计（三处改动，均在 reportNode 作用域内）

### 1. verdict 以 evaluator 结果为准，不用 merge 推导
- 从 `reconciledSubTasks` 的 evaluator 结果推导 verdict：sub_task 通过契约评估即记 PASS，**与 PR 是否 merged 无关**。
- 实现细节（由 writing-plans/实现阶段读 harness-task.graph.js 确定确切字段）：判定依据用 sub_task 的 evaluator 信号（`evaluate_verdict` / `ci_fail_type` / `evaluator_feedback` / `status==='failed'`），而非 `status==='merged'`。
- "evaluator PASS 但 PR 未 merged" → verdict=PASS（run done），未合并仅作为独立待办，不进 verdict。

### 2. failure_reason 严禁空串
- FAIL 路径 reason 必须非空、可诊断：优先 `failed_scenarios` 名;为空时回落到聚合 sub_task 的 `ci_fail_type`/`evaluator_feedback`;再不济给明确文案（如 `"no failed scenarios recorded; sub_task(s) not passed: <ids>"`)。
- 不变量：verdict=FAIL ⇒ reason 非空串。

### 3. reportNode 在 PASS 后自合 PR（绕开 CI auto-merge）
- verdict=PASS 后（行 1441 判定处之后、写 DB 之前），遍历 `reconciledSubTasks`，对有 `pr_url` 且未 merged 的，调 `gh pr merge <pr> --squash --delete-branch` 合并。
- 复用 `mergePrNode`(harness-task.graph.js:614-689) 的 `execFile` 口径，注入 `opts.execFile`（默认真实 execFile，测试可 mock）。
- **合并失败只 `console.warn` + 标"待合并"，绝不回退 run failed**（已 PASS 的 run 不因合并问题变 failed）。

## 组件与数据流
- 仅改 `harness-initiative.graph.js` 的 reportNode 一个函数 + 其依赖注入口（opts.execFile）。
- sub_task 字段来源：runSubTaskNode 返回（status / pr_url / ci_fail_type / evaluator_feedback）。
- 不新增节点、不跨文件重构。

## 错误处理
- 合并 PR 失败 → 非致命（warn），run 维持 done。
- DB 写入沿用既有 client.connect/query/release。

## 测试策略（四档）
- **Unit（主，必做）**：`__tests__/harness-initiative-graph.test.js`（vitest，mockPool + 注入 `opts._checkPrMerged` / `opts.execFile`）新增 case：
  1. evaluator 全 PASS + sub_task 有 pr_url 但 status≠merged → verdict=PASS、phase=done（**先红**：当前实现会判 FAIL）。
  2. 真实 `failed_scenarios=[{name}]` → verdict=FAIL 且 failure_reason 含场景名、**非空**。
  3. verdict=FAIL 但 failed_scenarios=[] → failure_reason **非空**（回落文案/聚合 feedback）。
  4. verdict=PASS → `opts.execFile` 被以 `gh pr merge` 调用;mock 合并抛错 → run 仍 phase=done（不回退 failed）。
- **Integration / E2E**：不适用（纯 graph 内部逻辑，无服务边界 / 真实外部 IO；合并走 mock 注入）。
- **Trivial**：无。

## 不包含（独立、次要，另行排查）
- CI `ci.yml` auto-merge job 为何 skip（concurrency 假设未证实，需 GitHub 侧验证）。
- orphan-pr-worker 调度（只处理无 task 的孤儿 PR，与本症状无关）。

## 验收
- evaluator PASS + PR 未合 → run=done（不再空 reason failed）。
- FAIL 路径 failure_reason 恒非空、含可诊断信息。
- reportNode PASS 后自动合 PR;合并失败不致 run failed。
- 先红后绿两段式 commit;CI 全绿（dep-audit 既有问题除外）。
