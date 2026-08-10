task_id: 5594458d-6a57-4efc-8d61-9f0a79999b48
gear: hotfix
title: auto-merge 归属判据改向 Brain 求证（堵住 harness PR 绕过裁判闸的漏洞）
法源: 决策 e8f6134f-4131-4145-a893-79eb098011d9；事故 PR #4755

## Definition of Done（验收断言 → 测试映射）

- [x] [BEHAVIOR] Brain 回答「属于 harness run」→ should-auto-merge.sh 输出 SKIP、退出码 0
      Test: .github/workflows/scripts/__tests__/should-auto-merge.test.sh（Brain owned → SKIP）
- [x] [BEHAVIOR] Brain 回答「不属于任何 harness run」+ cp-* 分支 → 输出 MERGE
      Test: should-auto-merge.test.sh（Brain not-owned + cp-* → MERGE）
- [x] [BEHAVIOR] fail-closed 红线：Brain 超时 / 5xx / 非法 JSON 三者均 SKIP 且日志含降级原因；任一 MERGE 即失败
      Test: should-auto-merge.test.sh（assert_failclosed curl_timeout / curl_5xx / curl_badjson）
- [x] [BEHAVIOR] 零回归：非 cp-* 分支 → SKIP
      Test: should-auto-merge.test.sh（非 cp-* 分支 → SKIP）
- [x] [BEHAVIOR] 回归（真实历史数据）：分支 cp-08101107-04e4690d（#4755）判定为 SKIP，事故不复现
      Test: should-auto-merge.test.sh（#4755 分支 fix(orchestrator): 标题 + Brain owned → SKIP）
- [x] [ARTIFACT] Brain 只读端点 GET /api/brain/harness/pr-ownership（输入 branch/pr_number/pr_url，返回归属）
      Test: packages/brain/src/__tests__/harness-pr-ownership.test.js（路由 owned/not-owned/400/500）
- [x] [ARTIFACT] 归属判据纯函数 resolvePrOwnership（pr_url 精确匹配 + 分支短 id 前缀兜底）
      Test: harness-pr-ownership.test.js（extractBranchIdTokens / buildOwnershipQuery / resolvePrOwnership）
- [x] [ARTIFACT] smoke：已知 harness PR 与已知非 harness PR 分别返回正确归属
      Test: packages/brain/scripts/smoke/auto-merge-ownership-gate-smoke.sh（登记于 smoke-allowlist.txt）

## 边界（未做，按任务约束）
- 不动 harness 自身 mergeGate、不动 evaluator/judge 流程、不动 gear 分档。
- 不回滚已被误合并的 #4755。
- 不改 harness-generator 的 PR 标题规范（本次要点即「不再依赖标题」）。
