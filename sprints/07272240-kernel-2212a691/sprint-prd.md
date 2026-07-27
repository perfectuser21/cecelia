# Sprint PRD — Kernel provider-neutral 容量判定恢复

## OKR 对齐

- **对应 KR**：KR2（算力全开 — 3台Mac Mini slot利用率≥70%，Codex自动扫描进化）
- **当前进度**：91%
- **本次推进预期**：修复 Kernel 真实 dispatch 链路的容量误判与错误放行，恢复 provider/account 级容量收账可信度

## 背景

当前进行中的 P0 恢复任务要求把 Kernel 容量判定重新收回到真实 dispatcher → harnessSlotCheck → launchKernelProcess 链路，不能依赖自报成功的新 helper。该修复直接支撑 Cecelia 算力利用率与调度可信度，并延续 2026-07-27 之前同 Journey 的失败恢复：此前 run 因 `capacity_contract_revision_and_theater_oracle_pivot` 失败，本次必须把 reviewer 修订和 theater audit 的红点机械闭合。

## Golden Path（核心场景）

用户/系统从 [Brain tick 选中待执行的 Kernel 任务] → 经过 [Kernel 真实 dispatcher 按服务端 run 状态解析 role/action，并从 task.payload.role_assignments 解析冻结的 provider/account target] → 到达 [容量准入只基于 canonical active attempts、真实快照与独立硬闸做出稳定 allow/reject，完成消除双扣后再由允许任务进入真实 launchKernelProcess/unified Controller 触发]

具体：
1. Brain tick 在本地 API 路径选中两个服务端持有的 Kernel 任务：一个固定到已满的 Claude 账号，另一个固定到仍有空闲的 Codex 或 Grok 账号。
2. dispatcher 读取任务行与 run 状态，推导当前角色/动作，并把该任务在 `role_assignments` 中冻结的 provider/account target 传给容量准入；legacy relay 完全走隔离旧适配器，非 Kernel/relay 任务在进入 provider-neutral 快照逻辑前先被分流出去。
3. harnessSlotCheck 用 canonical active attempts（仅 `queued|starting|running`）和真实 provider/account 占用重算容量；relay/inflight/kernel 账本只按一个显式去重键计一次，以机械方式消除双扣，内存、磁盘、quota、global hard seats 仍各自独立判定。
4. Claude 已满任务收到稳定拒绝原因，不会因为别的空闲账号而被误放行；独立的 Codex/Grok 空闲任务穿过真实 harnessSlotCheck，并继续走真实 `launchKernelProcess` 或 unified Controller 触发，不接受 helper 返还 path array/boolean 作为“通过”证据。
5. 当真实 `harness_attempts` 行从 active 转成 terminal（仅 `completed|completed_with_concerns|needs_context|blocked|failed|cancelled`）后，下一次真实 occupancy 查询自然释放容量；未知 provider/account、快照缺失、快照过期、usage API 失败、各独立硬闸都返回稳定且可区分的 exact reason。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 选中的 provider/account 未知时，只拒绝当前 pinned 任务，不污染其他健康任务的 admission。
- Kernel snapshot 缺失、`sampled_at + cache_ttl` 过期或 usage API 失败时，Kernel provider-neutral 路径必须 fail-closed 并给出稳定 reason；legacy 路径行为不变。
- `free=max(0,safe_limit-active(provider,account))` 的反例 `total=4, active=2, free=2` 在其他独立硬闸都通过时必须允许；任何仍保留 `occupied>=min(acct_cap...)` 旧逻辑的实现都应被红测抓住。
- 红证据必须在依赖加载完成后，因为业务行为缺失而失败；不能仅因为缺少 vitest/config 等基础依赖报红。
- `payload.review_required=true` 的真实任务行继续触发 current-SHA evaluator/judge/human gate；首次 merge/deploy 等待用户批准。

## 范围限定

**在范围内**：统一 `execution-contract`、`attempt-store` SQL、occupancy query、`harnessSlotCheck` 的 active/terminal 状态 SSOT；修正 per-account 容量与去重账本；让 dispatcher 从服务端 run 状态与任务行解析真实 target；在 provider-neutral Kernel 路径前切出完全隔离的 legacy adapter；补齐双任务/双 cycle 真链路验收与稳定 reason 覆盖。
**不在范围内**：生产数据库变更；新增 `recovered_at` 或命令式 release helper；为本单新增自报成功 helper；修改 legacy 旧适配器的业务语义；放开 current-SHA human gate；扩展到与本次 pinned provider/account 无关的调度策略优化。

## 假设

- [ASSUMPTION: `task.payload.anchor.step_id=0cdadc1a-e3a0-46a1-8333-ebbc102883f7` 对应本 Journey 中 Kernel provider-neutral capacity recovery 的当前 step。]
- [ASSUMPTION: 本次以 `packages/brain/src/` 为唯一实现位置，符合 thin_prd 中 “Kernel 真实 dispatcher” 的位置词与目标模块。]
- [ASSUMPTION: `target_environment=local_api` 已由 payload 明确给出，因此 proposer/evaluator 在本地 Brain API 与本地测试数据库上完成真链路验收。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: 让 dispatcher 以服务端 run 状态和任务行解析真实 role/action 与冻结 target，并在 Kernel/legacy 边界前做路由。
- `packages/brain/src/slot-allocator.js`: 收口 canonical active attempts、per-account free 计算、去重账本与 exact stable reasons。
- `packages/brain/src/orchestrator/attempt-store.js`: 对齐 active/terminal 状态 SSOT，使真实 attempt 终态驱动容量自然释放。
- `packages/brain/src/orchestrator/execution-contract.js`: 对齐 harness 结果状态枚举，避免 contract 与容量账本分叉。
- `packages/brain/src/harness-skill-relay.js`: 保持真实 `launchKernelProcess`/unified Controller 触发链可被验收，不引入自报成功旁路。
- `packages/brain/src/__tests__/harness-slot-check-kernel.test.js`、`packages/brain/src/orchestrator/__tests__/dispatcher.test.js`、`packages/brain/src/orchestrator/__tests__/ground-truth.test.js`: 锁定 provider/account pinned admission、legacy 隔离边界、review_required gate 与 exact reasons。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: current-SHA evaluator/judge/human gate 持续生效，首次 merge/deploy 需用户批准
- 可观测: stale sampled_at+cache_ttl、missing snapshot、usage API failure、unknown provider/account、各独立硬闸都返回稳定且可区分的 exact reason；红证据在依赖加载后因业务行为缺失而失败

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [真环境验证] 依赖真实调用链的接缝断言必须在真目标上验证过才算 done（来源: area）
- [环境假设] 禁止写死环境假设值；provider/account、容量快照与调用方信息必须从真实环境或任务行解析（来源: area）
- [租户隔离] 涉及租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块可留占位；最终可执行脚本由 proposer 按 `target_environment=local_api` 产出。本 sprint 必须验到真实 dispatcher/tick 链路与真实容量收账，而不是 helper 自报成功。

```bash
# 占位：proposer 将按 local_api 填入真实脚本（curl localhost:5221 + 真实测试 fixture/DB 查询）
# 期望验收点（自然语言）：
# 1. 创建两个服务端持有任务/周期：Claude-pinned 满额任务被真实 harnessSlotCheck 拒绝，并返回稳定 exact reason。
# 2. 独立的 Codex/Grok-pinned 空闲任务走真实 dispatcher/tick -> harnessSlotCheck -> launchKernelProcess/unified Controller 触发链。
# 3. 真实 harness_attempts 行从 queued|starting|running 进入 terminal 后，重跑 occupancy 查询自然释放容量；不存在 recovered_at 或命令式 release helper。
# 4. legacy 非 Kernel/relay 任务仍走隔离旧适配器，Kernel snapshot 缺失/过期不会改变 legacy fail 行为。
# 5. unknown provider/account、snapshot 缺失、snapshot stale、usage API failure、memory/disk/quota/global hard seats 各自返回稳定 reason，并验证 unrelated unknown isolation。
```

## journey_type: autonomous
## journey_type_reason: 需求集中在 `packages/brain/src/` 的 dispatcher、slot allocator、attempt-store 与 harness 链路，属于 Brain 内部/纯后端修复
## target_environment: local_api
## target_environment_reason: payload 已显式给出 `local_api`，验收应在本地 Brain API（`localhost:5221`）与本地真实调度/测试链路完成
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
