# Sprint PRD — Kernel Provider-neutral Capacity Accounting Recovery 2

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 Kernel provider/account 容量核算与恢复账本的五个机械阻塞点，恢复 P0 调度可信度

## 背景

本任务是对失败 run `2972222e-151c-4db1-951d-1abc0acca546` / 恢复任务 `9315c992` 的二次恢复，reviewed_contract_sha `b1aeccddb` 仅保留为证据，不继承任何审批。目标是让统一 Kernel Controller 按服务端可信 provider/account/candidate 与 active attempts 核算容量，真实利用多账户/多服务器且不双扣、不误放行，并保持 memory、disk、quota、hard-seat、fail-closed 闸门不被削弱。

## Golden Path（核心场景）

调度系统从 [Brain tick/dispatcher 选中待派发 harness 任务] → 经过 [按服务端角色锚定唯一 provider/account 候选并核对 capability snapshot + active attempts] → 到达 [Claude 满载时可转派有空闲的 Codex/Grok 账户；快照缺失/过期/未知时稳定拒发]

具体：
1. dispatcher 或 tick 触发 harness 派发时，先从服务端拥有的 task/run 角色分配解析本次 immutable role target，只交给该 provider/account 对应候选参与 admission
2. harnessSlotCheck / Kernel Controller 用同一套 attempt 状态 SSOT 识别 active=`queued|starting|running`、terminal=`completed|completed_with_concerns|needs_context|blocked|failed|cancelled`，并让 recovered terminal attempt 立即释放占用
3. admission 先算选中 account 的 `free=max(0,safe_limit-active(provider,account))`，再独立叠加 memory、disk、quota、global hard seat 等硬闸；`total=4, active=2, free=2` 且其他硬闸允许时必须放行
4. capability snapshot 缺失、局部缺 provider/account、sampled_at 超过 cache_ttl、usage API 出错或候选状态 unknown 时，本候选 fail-closed 并给出稳定 reason；无关的空闲 Grok/Codex 账户不得替 pinned 不可用账户顶替放行
5. 真实链路验证 `dispatcher/tick -> harnessSlotCheck -> unified Controller`：Claude 容量满时拒 Claude 候选，但符合角色约束且有空位的 Codex/Grok 候选可被派发；同 attempt 从非终态进入 recovered terminal 后容量释放可观测

## 边界情况

- legacy relay/account usage 必须明确选一种边界：统一归一进 provider-neutral snapshot，或完全走隔离的非 Kernel 路径；两者都不能与 Kernel fail-closed 语义冲突
- snapshot 只缺某个 candidate 的 provider/account 时，只拒该 candidate，不得把整个 pool 误判 unknown
- 同一尝试若账本同时出现在 relay/kernel/attempt 多源，必须去重，禁止二次扣减 account 占用
- 同一 attempt 状态重复回写 terminal 时，不得重复释放或出现负数 free
- sampled_at 或 cache_ttl 缺失、格式非法、陈旧时必须拒发，不得回退到 fail-open

## 范围限定

**在范围内**：
- Kernel admission 的 provider/account/candidate/active-attempt-aware 容量核算
- attempt 状态 SSOT 与 recovered terminal 释放容量
- 服务端可信 role target 与 capability snapshot 的候选交集
- legacy usage 边界定案与缺失/部分/陈旧 snapshot 的 fail-closed 规则
- 真实 dispatcher/tick 到 unified Controller 的 proven-to-fire 测试与 stale snapshot / release 回归测试

**不在范围内**：
- memory、disk、quota、hard-seat 规则放宽或语义改写
- reviewed_contract_sha `b1aeccddb` 的审批继承
- merge、deploy 或人审流程简化
- UI、Dashboard 或生产环境发布改动

## 假设

- [ASSUMPTION: payload.review_required=true 代表这是首个 P0 controller 行为变更，本 sprint 结束后仍需 evaluator、judge 与人工审批共同绑定最终 SHA]
- [ASSUMPTION: 目标实现落在 `packages/brain/` 主链，属于 Brain/Kernel 后端恢复，不涉及额外前端入口]
- [ASSUMPTION: journey `bb8cc561-b3ee-4fec-b74d-2255694bd963` 当前无已验收 golden path 历史可复用，因此累积 FR 为空]

## 预期受影响文件

- `packages/brain/src/slot-allocator.js`：统一 account free、active attempts 与 fail-closed admission 判定
- `packages/brain/src/dispatcher.js`：真实 dispatcher/tick 派发入口接入服务端可信候选交集与 slot check
- `packages/brain/src/orchestrator/execution-contract.js`：attempt 状态 SSOT 与 terminal/recovered 语义对齐
- `packages/brain/src/__tests__/harness-slot-check-kernel.test.js`：覆盖 double debit、stale snapshot、recovered terminal release
- `packages/brain/src/__tests__/dispatcher*.test.js` 或同链集成测试：证明 Claude 满载但 Codex/Grok 可派发的真实链路

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：capacity snapshot 超过 `sampled_at + cache_ttl` 必须按 stale 拒发，不得继续使用旧样本
- 频控：无新增频控；本 sprint 不改调度节流策略
- 版本要求：无新增版本约束
- 可观测：缺失/unknown candidate snapshot、usage API 错误、stale snapshot、terminal release 都必须给出稳定 reason，并能在真实 dispatcher/tick 链路测试中被机械验证

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [语义一致] 同一语义值在判定端与终验端必须同一处理策略，禁止 unknown/stale 在不同脚本出现分叉（来源: area）
- [真链验证] 调度接线优先用真实链路/源码接缝验证，不能只靠 synthetic candidate.role 或纯 mock 证明通过（来源: area）
- [Fail Closed] 缺失真目标快照、usage 真相或关键时间字段时必须显式拒发，禁止 warning 降级或 fail-open（来源: area）
- [Smoke 随 PR] `packages/brain/src` 的行为改动必须随 PR 带齐可执行 smoke/回归证据，别等 CI 两连红（来源: area）
- [真环境验证] 依赖真实 dispatcher/tick 与 provider/account 组合的断言，必须在真实目标链路验证后才算 done（来源: area）
- [单 slot 串行] 一个 slot/会话内严格串行执行任务，不借并发掩盖容量账本错误（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只框定端到端验收点；proposer 需按 `target_environment=local_api` 产出真实脚本。

```bash
# 占位：proposer 将填入 curl localhost:5221 + 真实测试命令
# 期望验收点：
# 1. 构造真实 task/run 角色分配，Claude account 满载且 pinned 目标不可用时，dispatcher/tick -> harnessSlotCheck -> unified Controller 明确拒 Claude
# 2. 同链路下，符合同一 role target 且有 free>0 的 Codex 或 Grok account 可被派发，不能被无关账号或 synthetic candidate.role 误导
# 3. snapshot sampled_at 超过 cache_ttl、缺 provider/account、usage API 报错、candidate unknown 时稳定 fail-closed，并返回固定 reason
# 4. 同一 attempt 从 queued/starting/running 进入 recovered terminal 后，account free 立即回升；重复 terminal 不会二次释放
# 5. `total=4, active=2, free=2` 反例在 memory/disk/quota/hard-seat 允许时可通过 admission，证明不存在 double debit
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain/Kernel 后端调度与容量账本恢复，范围锚定 `packages/brain/`
## target_environment: local_api
## target_environment_reason: payload 已显式指定 `local_api`，验收依赖 localhost:5221 的 Brain API 与本地测试链路
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
