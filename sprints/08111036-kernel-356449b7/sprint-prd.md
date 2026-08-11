# Sprint PRD — kernel 账号选择接入用量数据：429 周限触发 target 轮换而非 run 终态

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+2%（消除 account1 CAPPED 导致的批量 run 假死，恢复算力全开）

## 背景

Brain issue 7c9f427e（P0）。近 48h 内 13 个 initiative_runs 死于 `failure_reason=callback_runner_failure`，
其 harness_attempts 全部为 claude/account1 + HTTP 429 "You've hit your weekly limit"（account1 7d=100% CAPPED）。
Brain 的 account-usage 系统明确知道 account1 CAPPED（ad-hoc dev spawn 已能正确选 account2），
但 kernel 执行目标选择不消费该数据：`resolveExecutionTarget` 只查 per-run `exhausted_targets`（每个新 run 从空开始，
静态白名单 claude 首位恒为 account1），而 `execution-contract.js` 把 429 归类为 runner_failure → derive 判 run 终态 failed，
不轮换账号。P0『合并权收归单一裁决闸』4 连环重试全灭于此。本 sprint 让 kernel 把配额类失败识别为账号耗尽并在同一 run 内轮换。

## Golden Path（核心场景）

系统从 [claude/account1 命中 429 周限] → 经过 [识别为配额耗尽类失败·计入 exhausted·轮换到下一可用账号] → 到达 [同一 run 内换 account2 重试该 attempt，run 不进 failed 终态]

具体：
1. [触发条件] 某 attempt 用 claude/account1 执行，runner 回调携带 HTTP 429 且消息含 "weekly limit"/"rate limit" 等配额语义。
2. [系统处理] execution-contract 把该失败识别为「账号耗尽类」failure_class（区别于普通 runner_failure），该 target 被计入本 run 的 exhausted_targets，derive 不将其判为 run 终态失败。
3. [系统处理] resolveExecutionTarget 选目标时消费 account-usage 活数据：已 CAPPED 的账号在候选排序中被跳过或排最后；据此选出下一个可用 claude 账号（如 account2）。
4. [可观测结果] 同一 run 内产生一个新的、指向 account2 的 attempt；run 状态保持 running/进行中，不以 `callback_runner_failure` 终态收尾。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- account1 与 account2 均 CAPPED：无可用 claude 账号 → resolveExecutionTarget 返回 blocked（`all_execution_targets_exhausted`），此时才允许 run 走终态，不得静默假死。
- 429 但非配额语义（如偶发限流无 weekly/rate 关键词）：不误判为账号耗尽，保持既有 runner_failure 语义，避免过度轮换。
- account-usage 数据不可达/为空：降级为既有静态白名单顺序，不得因取用量数据失败而 crash 选目标流程。
- 同一 run 内重复 429：已 exhausted 的 account1 不得被再次选中造成轮换死循环。

## 范围限定

**在范围内**：
- claude 账号维度的配额失败识别（429 weekly/rate limit → 账号耗尽类 failure_class）。
- 同一 run 内 exhausted 记账 + 轮换到下一可用 claude 账号，run 不进终态。
- resolveExecutionTarget 消费 account-usage 的 CAPPED 判定（跳过/排最后），与单一事实源对齐。
- failing test 先行 + 永久入 CI 回归。

**不在范围内**：
- 不改生产安全参数（approvalRateLimit 等禁动，见 08-09 教训）。
- 不动 codex/grok 的 target 语义，只修 claude 账号维度。
- 不做大重构：不合并两套账号系统，只让 kernel 消费 account-usage 的判定结果。

## 假设

- [ASSUMPTION: account-usage 已提供可供 kernel 同步查询的 CAPPED 判定接口/数据（issue 描述称 ad-hoc dev spawn 已消费同款数据）；proposer 阶段确认具体读取入口。]
- [ASSUMPTION: 「配额耗尽类」failure_class 可复用/扩展现有 migration-366 引入的 kernel harness failure_class 枚举，而非新建独立系统。]
- [ASSUMPTION: run 不进终态 = attempt 层失败但 run 保持 running 并派新 attempt；由 derive 逻辑区分 attempt-level vs run-level 终态。]

## 预期受影响文件

- `packages/brain/src/orchestrator/preflight/execution-targets.js`: resolveExecutionTarget 候选排序接入 account-usage CAPPED 判定，跳过/降权已 CAPPED 账号。
- `packages/brain/src/orchestrator/execution-contract.js`: 将 429 weekly/rate limit 归类为账号耗尽类 failure_class（thin_prd 写的 preflight/ 路径有误，实际在 orchestrator/ 根）。
- `packages/brain/src/orchestrator/derive.js`（或等价 derive 逻辑）: 账号耗尽类失败不判 run 终态，触发同 run 内轮换重试。
- `packages/brain/src/orchestrator/preflight/execution-targets.test.js`: 新增 CAPPED 账号不被选为首选的回归测试。
- `packages/brain/src/orchestrator/__tests__/execution-contract.test.js` / `derive.test.js`: 新增 429 weekly limit → 轮换 account2 且 run 不终态的 failing→passing 回归测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 sprint 查得空）+ PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；取 account-usage 数据须同步/低延迟，不阻塞选目标）
- 频控: 保持既有 approvalRateLimit 等生产安全参数不变（PrepPRD 硬边界）
- 版本要求: 无
- 可观测: 账号耗尽类轮换与最终 blocked 必须可在 DB/日志复查（run/attempt/exhausted_targets 有迹可循），禁止静默假死

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 journey/ability 无 step/feature 级 invariant）；仅注入与本 sprint 直接相关的红线 -->
- [vitest 范围] 合同验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径绿态也退出 0，新增 test 必须落在 CI include 范围内才算真回归（来源: area）
- [local_api meta] local_api/无 UI smoke 任务对 judge 机械闸⑤（meta_verification_gap）会死锁，此类任务需在合同内以 DB/日志证据替代 UI 证据（来源: area）
- [证据充分] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」，evidence_insufficient 优先走 evaluator 补证（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（vitest + psql/curl）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest 单测 + 必要时 psql 复查 run/attempt 记录）
# 期望验收点（自然语言）：
# 1. 单测：claude/account1 命中 429 weekly limit 的 attempt 失败后，同一 run 产生一个指向另一账号（account2）的新 attempt，且 run 不以 callback_runner_failure 终态收尾。
# 2. 单测：已 CAPPED（account-usage 判定）的账号不被 resolveExecutionTarget 选为首选。
# 3. 全量现有 orchestrator/preflight 测试不回归（vitest 落在 CI include 范围内，exit code 真实反映）。
```

## journey_type: autonomous
## journey_type_reason: 根因与修复全在 packages/brain/ 纯后端 orchestrator，无 UI/agent 协议/engine 介入。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain/ 后端逻辑，验收走本地 evaluator vitest + psql localhost:5221 复查，无需真机/浏览器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
