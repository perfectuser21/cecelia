# Sprint PRD — runner 原语：一次执行 = 一行 task_runs（Brain 全执行路径 + 脚本步统一留痕并投影 Notion）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+2%（补齐执行留痕基座，消除「裸跑」盲区）

## 背景

审计（2026-09-23 origin/main f227396）：`task_runs` 表（migration 059）在 `packages/brain/src` 零 INSERT，仅被读取；执行留痕散落在 `task_events`/`dispatch_events`/`tasks.result`，`action_receipts` 只覆盖飞书/Bark/deploy 三个对外口；device_job/workflow_run 脚本步零 run 记录；Notion 无 run 投影面。本 sprint 建立「一次执行 = 一行 task_runs」的统一原语，让 Brain 所有执行路径与脚本步都必经它留痕，并在 Notion 与晨报上可见。链 bf5088a3 第 1 棒（F1 开发闭环，决策 105a5868 / 2e756506 先例：执行基座类基建验收引用 F1 既有断言）。

## Golden Path（核心场景）

系统执行一次任务或脚本步 → 经 run 原语开始/结束留痕 → 一行 task_runs 落库 → 投影 Notion → 晨报暴露裸跑。

具体：
1. [触发] Brain 任一执行路径（dispatcher / executor / openclaw-agent-executor / cecelia-run / bridge）或脚本步（采收线 harvest 8 步为样板）开始一次执行。
2. [开始] 该路径调用 run 原语「开始」→ 立即写入一行 task_runs（含 task_id、执行路径、开始时间、状态=running）。
3. [脚本步回调] 脚本步（device_job/workflow_run）经 ssh 回调把 run 的开始/结束写回 Brain，同一次执行只对应一行。
4. [结束] 执行结束时调用 run 原语「结束」→ 同一行 task_runs 补齐结束时间、exit code、产物引用、状态=succeeded/failed。
5. [投影] `notion-push-sync` 把 task_runs 作为一个投影面推到 Notion，人可见每次执行的开始/结束/exit/产物。
6. [出口] 晨报新增「裸跑检测」：某次执行有 dispatch_events 但无对应 task_runs → 标记 AMBER。

<!-- Response Schema（run 原语入参/task_runs 列契约）由 Proposer 在 Step 1.1 读 api_registry/migration 059 后推导，Planner 不定义技术规范。 -->

## 边界情况

- 同一次执行重复调用「开始」→ 幂等，不得产生第二行 task_runs。
- 执行崩溃未调用「结束」→ task_runs 仍留 running 行，晨报可据此发现悬挂 run（非静默丢失）。
- 脚本步 ssh 回调丢失/超时 → run 保持 running，不得伪造 succeeded。
- Notion 投影失败 → 不阻塞执行主链，留痕仍以 task_runs 为准（DB 是真相源）。

## 范围限定

**在范围内**：
- `lib` 层 run 原语 `startRun` / `finishRun`（唯一写 task_runs 的入口）。
- 接入 Brain 全部执行路径：dispatcher、executor、openclaw-agent-executor、cecelia-run、bridge。
- 脚本步（采收线 harvest 8 步为样板）经 ssh 回调写 run。
- `notion-push-sync` 增加 task_runs 投影面。
- 晨报（daily-report-generator / morning-cockpit-bark）增加「裸跑检测」AMBER 规则。

**不在范围内**：
- 迁移历史 task_events/dispatch_events 旧数据到 task_runs（只覆盖新执行）。
- 修改 task_runs 表结构（migration 059 已存在，沿用其列）。
- action_receipts 三个对外口的重构（本 sprint 不动）。
- Dashboard 前端展示 task_runs（本 sprint 只到 Notion + 晨报）。

## 假设

- [ASSUMPTION: task_runs（migration 059）现有列足以承载 task_id/执行路径/开始时间/结束时间/exit code/产物引用/状态；若缺列由 Proposer 在合同阶段提出加列]
- [ASSUMPTION: 采收线脚本步的 ssh 回调通道复用现有 device_job 回调机制，不新建通道]
- [ASSUMPTION: 「产物」在 task_runs 中以引用（路径/URL/ID）形式记录，不落大 blob]

## 预期受影响文件

- `packages/brain/src/lib/task-run.js`（新增）：run 原语 startRun/finishRun，唯一 INSERT/UPDATE task_runs 入口。
- `packages/brain/src/dispatcher.js`：派发执行路径接入 run 原语。
- `packages/brain/src/executor.js`：本地执行路径接入 run 原语。
- `packages/brain/src/openclaw-agent-executor.js`：agent 执行路径接入 run 原语。
- `packages/brain/scripts/cecelia-run.sh`：cecelia-run 路径接入（开始/结束回调）。
- `packages/brain/src/orchestrator-remote-bridge.js` / `harness-session-bridge.js` / `packages/brain/scripts/cecelia-bridge.cjs`：bridge 路径接入。
- `packages/brain/src/dispatch-helpers.js`：脚本步（harvest/device_job）ssh 回调写 run。
- `packages/brain/src/notion-push-sync.js`：新增 task_runs 投影面。
- `packages/brain/src/daily-report-generator.js` / `packages/brain/src/morning-cockpit-bark.js`：晨报「裸跑检测」AMBER 规则。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [单一写口] task_runs 只能由 lib 层 run 原语（startRun/finishRun）写入；任何执行路径不得绕过原语直插 task_runs（来源: 本 sprint 需求①）
- [必经留痕] Brain 全部执行路径与脚本步「一次执行 = 恰好一行 task_runs」，不得裸跑（有执行无 run 行）（来源: 本 sprint 需求①②④）
- [DB 为真相源] task_runs 是执行留痕的真相源，Notion 投影失败不得反向抹除或伪造 run 状态（来源: 本 sprint 需求③）
- （area 级既有铁律 dashboard 三件套与本后端 sprint 无交集，不在本 line 适用范围）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史；链 bf5088a3 第 1 棒，无已验收前序 ability）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/ability 无挂载），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；run 原语写库应为执行主链的非阻塞旁路，失败不阻断执行）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 执行失败或裸跑必须在 task_runs / 晨报可见（AMBER），不得静默

## E2E 验收

> Planner 初稿此区块留空占位。最终可执行的 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl + psql）
# 期望验收点（自然语言）：
#  1. 跑一条采收批（harvest 8 步）；
#  2. psql 查 task_runs：该批 tasks 表 8 行 step 各有恰好 1 行 task_runs 记录，
#     每行含 开始时间/结束时间/exit code/产物引用/状态；
#  3. 无「有 dispatch_events 无 task_runs」的裸跑（否则晨报应报 AMBER）；
#  4. notion-push-sync 后 Notion 可见这 8 行 run 投影（开始/结束/exit/产物）。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain 后端（执行路径 + 脚本步留痕 + 投影），无 UI、无 agent 协议、无 engine hooks
## target_environment: local_api
## target_environment_reason: Brain 内部执行留痕，E2E 用 curl localhost:5221 + psql 校验 task_runs 落库与 Notion 投影
## journey_id: none
## step_id: none（PrepPRD 未锚定）
