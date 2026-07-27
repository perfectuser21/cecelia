# Sprint PRD — Kernel 原子失败终结器与槽位自愈

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：Kernel 已有成功收账路径，但失败路径仍会留下 `terminal run + in_progress task` 幽灵槽位，P0 状态机可信度未闭环
- **本次推进预期**：补齐失败终结与基础设施重试闭环，消灭失败 run 不收账导致的永久占槽

## 背景

生产已证实两组历史实例 `task/run=51836fb2/13d41c64` 与 `05f41282/e2dad31b` 暴露同一根因：detached Kernel 成功 report 会事务性终结 run+task，但失败出口只把 `initiative_runs.phase` 标成 `failed`，没有统一写 `run.completed_at`、没有终结或重试 `tasks`，随后 watchdog 又按 failed run 过滤，导致 task 永久 `in_progress` 并持续占用 slot。

本 sprint 目标不是修补历史生产行，而是建立一条唯一、幂等、事务原子的失败终结合同，并把所有失败出口、基础设施重试与窄 reconciler 收口到同一语义，确保以后无论 run 如何失败，slot 都能回收，task 都有可审计终态。

`thin_prd` 明确要求“原子终结 run+task，基础设施最多重试3次，并以窄 reconciler 消灭 terminal run/in_progress task 幽灵槽位”，本 PRD 仅围绕这三个字面主题收敛范围。

## Golden Path（核心场景）

Kernel 运行中的当前 task 遇到失败出口 → 唯一 failure terminalizer 原子收账或按基础设施规则重排 → slot 释放且后续无幽灵任务残留

具体：
1. [触发条件] 当前 `run_id` 对应的 Kernel 执行在 hop cap、`ACTION.MARK_FAILED`、approved-but-no-contract、`blocked_same_state`、`ci_timeout`/deadline、`run.js` fatal catch 等统一失败出口之一触发失败
2. [系统处理] 唯一 `failure terminalizer(runId, taskId, reason, failureClass)` 在单数据库事务内按 `current_task_id` 精确匹配当前仍为 `in_progress` 的 task：hard failure 时原子写 `run failed + failure_reason + completed_at`，并把 task 写成 `failed + completed_at + error/result + 单条 status_history` 后清 claim；若 `failureClass=all_execution_targets_exhausted` 且重试次数未超 3 次，则当前 run failed 并 completed，task 清 claim、写 `retry_count/retry_after`、回 `queued`
3. [可观测结果] 失败 run 不再留下未完成时间戳；task 要么被原子终结为 `failed`，要么作为基础设施失败被安全回队；slot allocator 仅依据 `task.status` 计数时能从 1 降回 0；窄 reconciler 只处理 latest Kernel v2 terminal run 与精确匹配的 `current_task_id` 幽灵态并复用同一终结语义

## 边界情况

- 同一 run/task 重复调用 failure terminalizer：不得重复写 `status_history`，不得覆盖其他已终结状态
- task 已不再是当前 `current_task_id`、或状态已非 `in_progress`：不得误终结其他 task
- `all_execution_targets_exhausted` 仅对基础设施类失败自动重试，合同/评测/用户拒绝类失败不得回队
- 第 4 次基础设施失败越界后必须 hard fail，不得无限退避
- reconciler 只能处理 latest Kernel v2 terminal run；历史 run、paused/blocked/queued/completed task 一律跳过
- 正式 API `in_progress -> failed` 路径也必须补 `completed_at`，避免绕开 terminalizer 语义留下半终态

## 范围限定

**在范围内**：
- 建立唯一 Kernel failure terminalizer，定义 hard failure 与 `all_execution_targets_exhausted` 两类终结/回队合同
- 把 hop cap、`ACTION.MARK_FAILED`、三类 approved_but_no_contract、`blocked_same_state`、`ci_timeout`/deadline、`run.js` fatal catch 统一接到同一失败终结入口
- 为基础设施失败增加最多 3 次自动退避重试，并保留合同/评测/用户拒绝不自动重试的边界
- 窄 reconciler 只修 latest terminal run 与当前 `in_progress` task 的幽灵槽位
- 为 `routes/tasks.js` 正式 failed 路径补 `completed_at`
- 增补真 PG 原子性、幂等、history、claim、retry、fatal catch、reconciler 排除、slot 回收、ghost fixture 的 RED→GREEN 证据
- 更新 `packages/brain/DEFINITION.md`、根 `regression-contract.yaml` / `RCI`，并跑 DevGate、Brain unit/integration、smoke

**不在范围内**：
- 不回写或修改历史生产 task/run 行来“掩盖”缺陷
- 不改变 slot allocator 的 SSOT 原则，不允许通过 JOIN run 绕过脏状态
- 不新增 UI、Dashboard 或跨 repo 改动
- 不放宽 review gate；本次为 P0 首次状态机修复，Evaluator/Judge 仍需绑定 current SHA

## 假设

- [ASSUMPTION: `payload.target_environment=local_api` 为显式给定，E2E 以本地 Brain API 与 PostgreSQL 为准，不需要浏览器或远端 runner]
- [ASSUMPTION: `payload.anchor.step_id=0cdadc1a-e3a0-46a1-8333-ebbc102883f7` 即本 sprint 的 Golden Path 锚点，Planner 无需再扩展到其他 Journey Step]
- [ASSUMPTION: 生产历史实例仅作为回归 fixture 与合同边界来源，实施阶段不会直接改写这些生产记录]

## 预期受影响文件

- `packages/brain/src/`: failure terminalizer、失败出口接线、reconciler、slot 相关状态机代码
- `packages/brain/src/routes/tasks.js`: 正式 failed 路径补齐 `completed_at`
- `tests/` 或 Brain 对应单测/集成测目录：补齐 failure terminalizer、retry、reconciler、slot、自愈 fixture 证据
- `packages/brain/DEFINITION.md`: 版本更新
- `regression-contract.yaml`: 回归合同更新
- `RCI` 相关根文件：与本次 P0 状态机修复证据同步

## E2E 验收

> Planner 初稿只锚定端到端验收结果；最终可执行脚本由 proposer 以 `target_environment=local_api` 翻译为 curl/psql/test 命令。

期望验收点（自然语言）：
1. 触发 hop cap、ci timeout、`blocked_same_state`、approved-but-no-contract、fatal catch 任一失败出口后，当前 run 都写入 `failed`、`failure_reason`、`completed_at`
2. 当前 `current_task_id` 且仍为 `in_progress` 的 task 被原子写成 `failed` 并带 `completed_at`、`error/result`、单条 `status_history`，claim 被清空；重复触发同一失败终结不会重复 history 或覆盖其他终态
3. `all_execution_targets_exhausted` 在第 1/2/3 次会把 task 清 claim、写 `retry_count/retry_after` 并回 `queued`；超过边界后 hard fail，合同/评测/用户拒绝类失败不自动重试
4. 窄 reconciler 只会修 latest Kernel v2 terminal run 与精确匹配的 `current_task_id` 幽灵态，不会批量改 paused/blocked/queued/completed 历史行
5. slot allocator 继续只按 `task.status` 计数，失败终结或回队后 used slot 从 1 正确回到 0
6. 正式 API `in_progress -> failed` 路径同样写 `completed_at`
7. 真 PG 事务测试能证明原子性/回滚/幂等；DevGate、Brain unit/integration、smoke 全绿并锚定 current SHA

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql + Brain tests）
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [跨模块时间常数依赖] 跨模块时间常数若存在隐含大小关系，必须显式写不变量断言或注释（来源: area）
- [错误码契约需显式else] 调用失败返回 null/false 契约函数时必须显式处理失败分支，不能只靠外层 try/catch（来源: area）
- [吞错job需失败计数告警] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [后台job须声明消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [git_sha语义跨脚本一致] 同一语义在判变端与终验端必须同一处理策略，避免假绿（来源: area）
- [共享CI文件默认禁区] 共享 CI 基础设施文件默认禁区，未经合同显式授权不可修改（来源: area）
- [提前合并需核对headSHA] PR 若被兜底机制提前合并，必须核对 evaluator/judge verdict 锚定 SHA 与实际合并 SHA 一致（来源: area）
- [PR需一次带齐smoke+allowlist] 涉及 `brain/src` 的 PR 需一次带齐 smoke 与 allowlist/证据要求，不能等 CI 两连红（来源: area）
- [单slot串行任务] 一个 slot 内严格串行执行任务，同一 slot 同时只允许一个任务在跑（来源: area）
- [真环境验证才算done] 依赖真实 API/数据库接缝的断言必须在真目标上验证后才算 done（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种至少 2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不准 ship（来源: area）
- [租户隔离] 触碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## NFR 约束

- 超时/延迟: 待定（PrepPRD 未指定具体阈值；本次必须补可验证的超时失败终结与 deadline 收口）
- 频控: 无新增对外频控要求；自动重试仅限基础设施失败且最多 3 次退避
- 版本要求: 无
- 可观测: 每条失败终结都必须留下 `failure_reason`、`completed_at`、单条 task `status_history` 与可查询的 retry/claim 状态；测试与评测证据必须绑定 current SHA

## journey_type: autonomous
## journey_type_reason: 仅涉及 `packages/brain/` 后端状态机、任务调度与本地 API/DB 验证，无 UI 或远端 agent 交互
## target_environment: local_api
## target_environment_reason: payload 已显式给定 `local_api`，验收位于 localhost:5221 Brain API 与本地 PostgreSQL
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
