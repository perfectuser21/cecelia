# Sprint PRD — Controller heartbeat 续租 lease（修 30 分钟杀跑）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 Harness 自跑 30 分钟被 ownerless reaper 误杀的 P0 recurrence）

## 背景

生产实证：run `60fa6c43` 于 11:46:35Z 建立 controller lease=12:16:35Z（固定 30m），orchestrator heartbeat 持续到 12:16:51Z，仍在 12:17:17 被判 `controller_lease_expired`，Generator `034b5ca7` 被 `reconcileOwnerlessKernelRuns` 取消。根因：`heartbeat.js` 的 UPDATE 只写 `orchestrator_heartbeat_at/host/pid`，从不延长 `controller_lease_expires_at`；`launchKernelProcess` 也未把创建时的 `controllerSessionId` 传给 detached child，心跳只有 run_id、无从做可信续租。另 run `752e0271`（gear=hotfix）在 1.2s 内 `assembly_fault:FROZEN_CONTRACT_ARTIFACTS_MISSING`，证明热修档缺冻结合同接线，故本刀走 default 标准全链修 heartbeat 续租；hotfix 合同物化不在本刀范围（仅附加回归记录该 fault）。

## Golden Path（核心场景）

系统从 [Controller 点火建 run] → 经过 [detached Kernel 携 session 心跳续租] → 到达 [超 30m 仍 active、仅假冒/终态被回收]

具体：
1. Controller 点火：`createKernelRun` 在同一事务落 `controller_session_id` 与 `controller_lease_expires_at = now + CONTROLLER_LEASE_DEFAULT_SECONDS`（1800s，单一 SSOT）；缺 session 时 fail-closed 不建 run。
2. `launchKernelProcess` 把创建时的 `controllerSessionId` 作为 `--controller-session-id` 传给 detached child；`runKernelMain` 解析该参数并原样透传给 loop，禁止仅凭 run_id 续租。
3. loop 每跳心跳携带 `controllerSessionId` 调 `writeHeartbeat`；其 UPDATE 同时写 orchestrator 三列心跳与 `controller_lease_expires_at = GREATEST(existing, now + lease)`，WHERE 条件含 `id` + `controller_session_id` + `phase NOT IN ('done','failed')`。
4. CAS 判定：rowCount=1 → lease 随心跳滚动延长，run 保持 active；rowCount=0（session mismatch 或 run 已 done/failed）→ Kernel fail-closed 退出，不静默续跑。
5. 出口（可观测）：心跳持续超过 30m 后 `reconcileOwnerlessKernelRuns` 对该 run 回收数=0；伪造/错误 `controller_session_id` 的续租不生效（CAS rowCount=0），无主 run 仍被 reconcile 回收。

<!-- Response Schema：本刀无新增 API 端点（内部 orchestrator + SQL 行为），Proposer 无需推导响应 schema。 -->

## 边界情况

- 错误/伪造 `controller_session_id`：CAS rowCount=0，不得续租，Kernel fail-closed。
- `phase` 已 `done`/`failed`：心跳 CAS rowCount=0，不得复活 lease。
- 存量 run（migration 415 前）`controller_session_id IS NULL`：读回 NULL 由 reconcile 接管回收，本刀不回填。
- `GREATEST(existing, now+lease)`：并发/时钟回拨下 lease 只增不减，避免误缩短已有租约。

## 范围限定

**在范围内**：`writeHeartbeat` 续租 CAS + fail-closed；`controllerSessionId` 从创建端经 `launchKernelProcess`→`runKernelMain`→loop 的可信透传；真 PG 集成回归；永久入 CI。
**不在范围内**：gear=hotfix 冻结合同物化（`FROZEN_CONTRACT_ARTIFACTS_MISSING`，仅附加回归记录，本刀不修）；lease 时长调参；reaper 巡检节奏变更。

## 假设

- [ASSUMPTION: `CONTROLLER_LEASE_DEFAULT_SECONDS=1800` 保持为 lease 时长唯一 SSOT，heartbeat 续租复用同一常量，不新增第二处时长定义。]
- [ASSUMPTION: 心跳频率沿用现状（loop 约 90s 一跳），远小于 1800s lease，不在本刀调整。]
- [ASSUMPTION: migration 415 的 `controller_session_id` / `controller_lease_expires_at` 两列已在生产，续租只做 UPDATE，不新增 schema。]

## 预期受影响文件

- `packages/brain/src/orchestrator/heartbeat.js`: `writeHeartbeat` 增 `controllerSessionId` 入参 + lease 参数；UPDATE 加 `controller_lease_expires_at=GREATEST(...)`，WHERE 加 session/phase 条件；返回 rowCount 供 CAS 判定。
- `packages/brain/src/orchestrator/loop.js`: `beat()` 透传 `controllerSessionId`；CAS rowCount=0 时让 Kernel fail-closed 退出。
- `packages/brain/src/harness-skill-relay.js`: `launchKernelProcess` args 加 `--controller-session-id`，把创建时 session 传给 detached child。
- `packages/brain/src/orchestrator/run.js`: `runKernelMain` 解析 `--controller-session-id` 并透传给 loop。
- `packages/brain/src/orchestrator/kernel-run-store.js`: 复用 `CONTROLLER_LEASE_DEFAULT_SECONDS` 作续租时长 SSOT（如需导出给 heartbeat）。
- `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js`（及相关 unit）: 新增 RED-1..RED-5 回归，永久入 CI。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空（step/feature 双源均空）；以下取自 PrepPRD thin_prd 显式值 -->
- 时长 SSOT：lease 时长唯一来源 `CONTROLLER_LEASE_DEFAULT_SECONDS`（1800s），禁止第二处硬编码。
- 一致性/fail-closed：续租走 CAS（`id`+`controller_session_id`+`phase NOT IN done/failed`），rowCount=0 必须 Kernel fail-closed，不静默续跑。
- 可观测：审计续租/回收事件写 `cecelia_events`；心跳续租失败可从 kernel 日志与 run 终态定位。
- 验证真实性：AI Evaluator 需独立跨过 30m 边界 + 真 PostgreSQL 复现，不得只看 CI 绿。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源为空，ability_id 未提供）；仅注入系统级硬红线 + 直接相关 harness 铁律 -->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [多租户默认] 测试默认多租户（来源: area）
- [凭据安全] API Key/Token/密钥不入 git、不落日志（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 租户隔离（来源: area）
- [无主fail-closed] 任何活跃 Kernel Run 前必先有有效 Controller ownership；缺失/空/非法 session 一律 fail-closed 进恢复，不静默放行（来源: area, migration 415 载体）
- [热修时钟] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 pr_url/pr_head_sha 与 GitHub 实时一致时首个 Evaluator 可建共享时钟（来源: area, ddca7267）
- （另有 ~70 条 capture-triage learning 归档为 area invariant，非本刀硬红线，此处略）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey (e6f803f2) golden-paths 查询：全部 ability 状态为 planned，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> 本刀 `target_environment=local_api`，真 PostgreSQL。Planner 先框定验收点，最终可执行脚本由 Proposer 在 GAN 阶段填入 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql 真 PG）
# 期望验收点（自然语言）：
#  1. 建 run(lease=30m)，注入 controllerSessionId 后持续 writeHeartbeat 跨过 30m 边界 →
#     psql 查 controller_lease_expires_at 已随心跳滚动前移，run.phase 仍非 done/failed；
#     此时跑 reconcileOwnerlessKernelRuns → 该 run 回收数=0。
#  2. 用错误 controller_session_id 调 writeHeartbeat → CAS rowCount=0（不续租）；
#     reconcile 仍把该无主 run fail-closed 回收（session mismatch 回收生效）。
#  3. phase=done/failed 的 run 调 writeHeartbeat → rowCount=0，lease 不复活。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 orchestrator + SQL 行为修复，无 UI、无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: RED-5 要求真 PostgreSQL 集成 + reconcile 回收数验证，走本地 evaluator（curl localhost:5221 + psql）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定 Golden Path step）
