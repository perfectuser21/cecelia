# Reviewer Feedback Round 1 — REVISION

## 必须修改（BLOCKER）

1. **[headed 场景核对] B8 缺失**：补 B8 断言 AI token 不得调用 adjudicate 端点（HTTP 403 或 401），或在未覆盖清单明确豁免理由（须 Controller 确认）。

2. **E2E-5 查询谓词不一致**：E2E-5 用 `payload->>'run_id'`（JOIN方式），DoD B4 用 `payload->>'acceptance_run_key'`（直接字段）。统一为 `acceptance_run_key` 直接字段形式。

3. **熔断触发时点歧义**：FR-5 须明确"每次调用 adjudicate 端点后实时重算"还是"run 整体转 adjudicated 后一次性触发"。二选一，proposer/evaluator 须理解一致。

4. **acceptance_bucket/anchor ASSUMPTION 未解析**：B4 依赖这两个字段。合同应在 B4 前置确认步骤要求 proposer 先执行 psql 确认字段存在；若缺失必须建 migration 394，不得悬空。

## 建议修改（NON-BLOCKER）

5. 自产数据排除 Invariant：未覆盖清单加第 8 条"不适用（adjudication 链路不触及守卫/探针写入路径）"。

6. 分流建单失败记日志：B4 补 grep Brain 日志断言，或 NFR 表中说明"日志验证依赖 CI 环境，本地 E2E 不强制"。

7. B6 测试命令统一：确认 `npm test` 等价于 `npx vitest run`，两处保持一致。
