# Sprint PRD — capability preflight failed_targets 时效窗口豁免（记仇不跨修复期）

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，82%）
- **当前进度**：82%
- **本次推进预期**：+1%（零人碰三连第 2 轮，r52 已 1/3）

## 背景

r40/r45/r50/r51 反复实证：`listFailedExecutionTargets`（attempt-store.js）按 attempt **终身记仇** —
只要某执行目标有 `status=failed` 且 `error_code` 非豁免的历史记录，就永久把该目标计入 `failed_targets`。
基础设施 bug 修复部署后，旧失败记录依然把仅有的两个执行目标 `(claude,account,us-mac-m4)` 全部 skip，
capability preflight 走向 `all_execution_targets_exhausted` 死等，每次都要 Commander 手动 psql 改 `error_code` 豁免。
根因：查询无时效窗口，把"修复期之前"的陈旧失败与"修复期之后"的新鲜失败一视同仁。

## Golden Path（核心场景）

系统从 [preflight 评估执行目标] → 经过 [统计最近失败目标] → 到达 [过期失败不再拉黑目标]

具体：
1. [触发条件] dispatcher 调 `listFailedExecutionTargets(runId, role)` 收集 `failed_targets` 供 preflight。
2. [系统处理] 该查询只统计**最近 N 小时**（默认 2h，可由 `HARNESS_FAILED_TARGET_TTL_HOURS` 配置）内 `created_at` 的失败记录；窗口外的旧失败记录不计入。
3. [可观测结果]
   - 陈旧失败（`created_at` 在窗口外，如 3h 前）→ 目标**不再**被拉黑，preflight 可正常派发。
   - 新鲜失败（窗口内）→ 记仇语义**不变**，目标仍被计入 failed_targets，连续失败仍轮换/耗尽。

## 边界情况

- `HARNESS_FAILED_TARGET_TTL_HOURS` 未设置 → 默认 2 小时。
- 记录恰好落在窗口边界（`created_at = NOW() - INTERVAL 'Nh'`）→ 归属需与测试断言一致（建议窗口内含）。
- 已有的 `error_code` 豁免逻辑（`worker_attempt_missing_after_lease` 等）保持不变，与时效窗口叠加生效。
- 空结果集（无任何失败记录）→ 返回空数组，行为不变。

## 范围限定

**在范围内**：`listFailedExecutionTargets` 查询增加基于 `created_at` 的时效窗口过滤；读取 `HARNESS_FAILED_TARGET_TTL_HOURS` 环境变量（默认 2）。
**不在范围内**：dispatcher preflight 决策逻辑本身、error_code 豁免清单、其它 attempt-store 查询、Commander 手动 psql 流程。

## 假设

- [ASSUMPTION: `harness_attempts.created_at` 已存在且为失败记录写入时刻（attempt-store.js:1086 已引用该列）。]
- [ASSUMPTION: 窗口边界采用"窗口内含"（`created_at >= NOW() - INTERVAL`）语义；具体由冻结测试断言锁定。]
- [ASSUMPTION: TTL 单位为小时，解析非法值时回退默认 2h。]

## 预期受影响文件

- `packages/brain/src/orchestrator/attempt-store.js`：`listFailedExecutionTargets` 增加 `created_at` 时效窗口 WHERE 条件 + 读 env 默认 2h。
- `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`（或同目录新增冻结测试文件）：登记 RED/GREEN 回归断言。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；以下为 PrepPRD/任务描述显式约束 + 本 line 运行历史（r45 family）沉淀 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 配置项: `HARNESS_FAILED_TARGET_TTL_HOURS`，默认 2（小时）
- 可观测: 沿用现有 attempt-store 行为，不新增副作用
- **合同/测试契约（r45 family 铁律）**：
  - `## Test Contract` 表必须逐行登记 artifacts 里每个冻结测试的**完整路径**；
  - 每条 BEHAVIOR 逐词取自对应测试文件真实 `it()` 名子串（含 repo 路径行）；
  - manual 命令带 `vitest -t` 过滤时，断言用 `grep -qE "[1-9][0-9]* passed"` **宽松式**，**禁**精确 `"(N)"` 尾缀（`-t` 过滤下 vitest 输出 `N passed | M skipped (K)`，精确尾缀必假红）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本任务无 ability 锚定，为空）；仅收录与 harness dispatch/attempt 结构相关者，其余 capture-triage learning 噪音略 -->
- [记仇窗口内不变] 时效窗口内的失败记仇语义不得放松：连续新鲜失败仍须轮换/耗尽（来源: 本 sprint 负向要求）
- [generator 重试身份] generator_infrastructure_retry_identity — 基础设施重试不得漂移执行身份（来源: area）
- [planner 分支] planner_role_branch — planner 使用服务端签发分支，禁自行 checkout 漂移（来源: area）
- [Brain URL 权威] Fleet Generator Brain URL authority — 组件只认权威 Brain URL（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 下 ability 均 status=planned，无 done/working -->
- （本 line 暂无已验收行为历史）

## E2E 验收

> Planner 初稿此区块留占位 + 自然语言期望验收点。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl/psql/vitest 命令，写进 contract-draft.md 的 `## E2E 验收` 与 `## Test Contract` 表。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest 单测 + 可选 psql 造数据）
# 期望验收点（自然语言）：
#  RED（修复前）：造一条 created_at=NOW()-3h、status=failed、error_code 非豁免的 harness_attempts 记录，
#                 listFailedExecutionTargets 返回该目标（旧失败仍拉黑）→ 断言应失败。
#  GREEN（修复后）：同一条 3h 前的过期记录不计入返回值（不再拉黑）；
#                   另造一条窗口内（<2h）的新鲜失败记录，仍出现在返回值（记仇语义不变）。
#  manual 命令若用 vitest -t 过滤，断言须为 grep -qE "[1-9][0-9]* passed"（禁精确 "(N)" 尾缀）。
```

## journey_type: autonomous
## journey_type_reason: 纯后端改动，仅涉及 packages/brain/ 的 attempt-store 查询，无 UI/agent 协议/engine。
## target_environment: local_api
## target_environment_reason: Brain 内部纯 API/后台查询逻辑，本地 evaluator 跑 vitest + 可选 psql localhost:5221。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
