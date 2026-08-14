# Sprint PRD — Controller heartbeat 续租 lease（修 30 分钟杀跑）

## Evaluator-feedback amendment（2026-08-14，PR #4876）

独立 Evaluator 先在 SHA `c940fa988283a95a929723d93c1e538d931ca5ee` 上确认 migration 416、审计、CodeQL 与 Preview 缺口；随后对冻结 SHA `93a1c50f4bbe038f3e27ad45f11cc6156823d9eb` 正式 FAIL，指出 actual Node CLI 与 migration 416 缺可执行合同行为、永久 CI 登记机检不完整、预期文件清单未对齐真实 38 文件，以及新增真 PG 测试 669 行违反单文件上限。第 7 轮在起点 `f2526d838e9c9cde44ac80f0d2cf5790cf54e207` 的 27 个真 PG 动作中发现 4 个 P1：parent task 已 `cancelled` / `completed` 时 planning run 仍续租并造事件，migration 416 仍接受 TAB / NBSP（现场同时证明 ideographic space 命中 PostgreSQL POSIX space）。本 amendment 将全部反馈收敛为可执行合同、真 PG/actual CLI 回归、≤500 行机械门禁和 base→head 文件闭环；`tests/` 下两份冻结测试保持逐字节不变。

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
3. loop 每跳心跳携带 `controllerSessionId` 调 `writeHeartbeat`；在同一事务内以单条 `UPDATE ... FROM tasks` CAS 写 orchestrator 三列心跳与 `controller_lease_expires_at = GREATEST(existing, now + lease)`，WHERE 同时绑定 run `id` + 权威 `controller_session_id` + active phase + parent task 非终态；CAS 成功后同事务写 `kernel_controller_lease_renewed` 审计事件。
4. CAS 判定：rowCount=1 → lease 随心跳滚动延长，run 保持 active；rowCount=0（session mismatch 或 run 已 done/failed）→ Kernel fail-closed 退出，不静默续跑。
5. 出口（可观测）：心跳持续超过 30m 后 `reconcileOwnerlessKernelRuns` 对该 run 回收数=0；伪造/错误 `controller_session_id` 的续租不生效（CAS rowCount=0），无主 run 仍被 reconcile 回收，并仅在真实终态改变的同一事务写 `kernel_ownerless_run_recovered` 事件。

<!-- Response Schema：本刀无新增 API 端点（内部 orchestrator + SQL 行为），Proposer 无需推导响应 schema。 -->

## 边界情况

- 错误/伪造 `controller_session_id`：CAS rowCount=0，不得续租，Kernel fail-closed。
- `phase` 已 `done`/`failed`：心跳 CAS rowCount=0，不得复活 lease。
- parent task 已 `completed`/`failed`/`cancelled`/`canceled`：即使 run 仍为 planning，心跳也必须 rowCount=0，heartbeat/lease/event 零推进。
- ownership 纯空白统一定义为“不含任何非空白字符”：JS Unicode White_Space+FEFF 与 PostgreSQL POSIX `[[:space:]]`+完整 Unicode whitespace 清洗、CHECK、heartbeat 参数及历史行判定一致，且不依赖数据库 locale。
- 存量 run（migration 415 前）`controller_session_id IS NULL`：读回 NULL 由 reconcile 接管回收，本刀不回填。
- `GREATEST(existing, now+lease)`：并发/时钟回拨下 lease 只增不减，避免误缩短已有租约。
- 审计身份：成功续租按 `(run_id, heartbeat_at)` 识别一个 hop，同身份重放只保留一条事件；错误 session、终态和 `guardRejected` 均为零事件。
- 审计原子性：事件 INSERT 失败必须回滚对应 lease 或 recovery 终态改变；payload 不得包含 `controller_session_id` 或其他 session secret。

## 范围限定

**在范围内**：`writeHeartbeat` 续租 CAS + parent task 非终态原子绑定 + fail-closed；`controllerSessionId` 从创建端经 `launchKernelProcess`→`runKernelMain`→loop 的可信透传；续租/recovery 审计的原子幂等语义；migration 416 与运行时 locale-independent whitespace ownership invariant；Evaluator 指出的动态正则 CodeQL high；Preview `starting` 端口冲突；真 PG 集成回归；永久入 CI。
**不在范围内**：gear=hotfix 冻结合同物化（`FROZEN_CONTRACT_ARTIFACTS_MISSING`，仅附加回归记录，本刀不修）；lease 时长调参；reaper 巡检节奏变更。

## 假设

- [ASSUMPTION: `CONTROLLER_LEASE_DEFAULT_SECONDS=1800` 保持为 lease 时长唯一 SSOT，heartbeat 续租复用同一常量，不新增第二处时长定义。]
- [ASSUMPTION: 心跳频率沿用现状（loop 约 90s 一跳），远小于 1800s lease，不在本刀调整。]
- [AMENDED FACT: migration 415 提供 `controller_session_id` / `controller_lease_expires_at` 两列；本 PR 明确包含 migration 416，以 PostgreSQL POSIX `[[:space:]]` 加完整 Unicode whitespace（含 FEFF）的 locale-independent helper 把历史纯空白 ownership 归一为 NULL，再加已验证的 nonblank CHECK，rollback 移除 CHECK/helper。续租运行时写路径使用既有表的原子 `UPDATE ... FROM tasks` + `cecelia_events` INSERT。]

## 预期受影响文件

- `.brain-versions`: Brain 发布账本同步为本 sprint 的 `1.273.8`。
- `DEFINITION.md`: Brain 版本与 schema 事实同步到 `1.273.8` / migration 416。
- `DoD.md`: Generator DoD 与批准合同的 lease、actual CLI、migration、审计和行数门禁条目一致。
- `package-lock.json`: 根 workspace 锁文件同步 `packages/brain` 版本。
- `packages/brain/migrations/416_controller_session_nonblank.sql`: 历史空白 ownership 归一为 NULL，新增并验证 nonblank CHECK。
- `packages/brain/migrations/rollback/416_controller_session_nonblank.down.sql`: rollback 真移除 migration 416 CHECK 与 schema_version 标记。
- `packages/brain/package-lock.json`: Brain 锁文件版本同步。
- `packages/brain/package.json`: Brain 版本同步为 `1.273.8`。
- `packages/brain/scripts/smoke/kernel-controller-lease-renewal-smoke.sh`: 真环境 smoke 验证续租实现与 schema/CI 接线。
- `packages/brain/src/__tests__/controller-session-passthrough.test.js`: 永久 RED-4 纯参数透传回归。
- `packages/brain/src/__tests__/integration/capacity-gate.test.js`: Preview `starting` 端口冲突真 PG 回归。
- `packages/brain/src/__tests__/integration/kernel-cli-ownership-preaction.pg.integration.test.js`: actual Node CLI 对错误、空白、缺失、不存在/正确 session 的真 PG 业务后验。
- `packages/brain/src/__tests__/integration/kernel-controller-lease-renewal.pg-fixture.js`: lease/audit/race/migration 测试共享的隔离真 PostgreSQL fixture。
- `packages/brain/src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js`: 续租 CAS、parent task cancelled/completed 零推进、审计原子幂等、reconcile 竞态与 pre-action ownership 真 PG 回归（拆分后 ≤500 行）。
- `packages/brain/src/__tests__/integration/migration-416-controller-session-nonblank.pg.integration.test.js`: JS 创建边与 migration 416 对 TAB/NBSP/ideographic space 的 upgrade/重复 upgrade/rollback/re-upgrade/重复 re-upgrade 真 PG 回归。
- `packages/brain/src/__tests__/kernel-controller-lease-renewal-e2e-oracle.test.js`: final-e2e 新鲜业务行 canonical oracle 回归。
- `packages/brain/src/__tests__/kernel-controller-lease-renewal-file-size.test.js`: 本 sprint 新增/拆出 JavaScript 测试与 helper 的永久 ≤500 行门禁。
- `packages/brain/src/__tests__/learnings-vectorize.test.js`: Brain 版本伴随的 learnings vectorize 测试事实同步。
- `packages/brain/src/__tests__/selfcheck.test.js`: schema 416 selfcheck 回归。
- `packages/brain/src/capacity-gate.js`: `starting` 记录端口被外部 listener 占用时在 admission 锁内重新分配并持久化。
- `packages/brain/src/harness-skill-relay.js`: `launchKernelProcess` 通过 `--controller-session-id` 透传创建端 session。
- `packages/brain/src/orchestrator/heartbeat.js`: `writeHeartbeat` 以单条 SQL 绑定 session/phase/parent task + locale-independent whitespace + GREATEST 续租，并与审计事件同事务。
- `packages/brain/src/orchestrator/kernel-controller-lifecycle.js`: ownerless recovery 复用 JS 非空白 ownership 谓词与参数化 PostgreSQL whitespace SSOT，仅在真实状态改变时同事务写幂等审计。
- `packages/brain/src/orchestrator/kernel-run-store.js`: 导出/复用 lease 与参数化 SQL whitespace SSOT，JS 使用 Unicode White_Space+FEFF 谓词，并维护 task 激活 ownership 栅栏。
- `packages/brain/src/orchestrator/loop.js`: 首次及逐跳 heartbeat 携 session，rowCount=0 在业务动作前 fail-closed。
- `packages/brain/src/orchestrator/run.js`: CLI 解析 session、延迟 task 激活，并把 ownership 丢失映射为 exit 2。
- `packages/brain/src/orchestrator/ground-truth.js`: legacy proposer 用静态 regex capture + 字符串比较关闭 CodeQL high。
- `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`: 动态正则与严格 proposer 识别回归。
- `packages/brain/src/orchestrator/__tests__/heartbeat.test.js`: heartbeat CAS/事务审计单元回归。
- `packages/brain/src/orchestrator/__tests__/run.test.js`: CLI session 透传、ownership 后 task 激活与 exit code 单元回归。
- `packages/brain/src/selfcheck.js`: `EXPECTED_SCHEMA_VERSION` 同步为 416。
- `packages/brain/vitest.config.js`: lease、actual CLI、migration 416 真 PG文件登记进 `POSTGRES_INTEGRATION_TESTS`。
- `packages/quality/smoke-allowlist.txt`: 登记 controller lease smoke。
- `sprints/08132021-controller-lease-renewal-r2/contract-dod.md`: 可执行 ARTIFACT/BEHAVIOR 验收闭环。
- `sprints/08132021-controller-lease-renewal-r2/contract-draft.md`: actual CLI、migration 和拆分后永久测试合同事实同步。
- `sprints/08132021-controller-lease-renewal-r2/red-evidence.md`: 原始功能 RED 与本轮 669 行机械门禁 RED 证据。
- `sprints/08132021-controller-lease-renewal-r2/sprint-prd.md`: 本清单与真实 base→head diff 逐项对齐。
- `sprints/08132021-controller-lease-renewal-r2/task-plan.json`: 单 task scope/dod/files 与真实 diff 精确对齐。
- `sprints/08132021-controller-lease-renewal-r2/tests/controller-session-passthrough.test.js`: 冻结 RED-4 制品，字节与批准 SHA-256 不变。
- `sprints/08132021-controller-lease-renewal-r2/tests/kernel-controller-lease-renewal.pg.integration.test.js`: 冻结 lease 真 PG 制品，字节与批准 SHA-256 不变。
- `tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js`: 既有 deadline harness fixture 适配 transactional heartbeat ownership。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空（step/feature 双源均空）；以下取自 PrepPRD thin_prd 显式值 -->
- 时长 SSOT：lease 时长唯一来源 `CONTROLLER_LEASE_DEFAULT_SECONDS`（1800s），禁止第二处硬编码。
- 一致性/fail-closed：续租走 CAS（`id`+`controller_session_id`+`phase NOT IN done/failed`），rowCount=0 必须 Kernel fail-closed，不静默续跑。
- 可观测/容量：每个 CAS 成功 hop 写至多一条 `kernel_controller_lease_renewed`，每次真实 ownerless 终态改变写一条 `kernel_ownerless_run_recovered`；按现有约 90s 心跳，上界约为单个持续运行 run 每日 960 条续租事件。续租事件以 `(run_id, heartbeat_at)` 为唯一身份，在事务 advisory lock 下去重；不为错误 session、终态或 guardRejected 造事件。
- 原子/凭据：审计与对应成功状态改变同事务提交，事件失败则状态回滚；payload 不含 controller session secret。
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
#  4. psql 查成功续租/recovery 各有一条对应 cecelia_events；同 hop 重放不重复，
#     错误 session/终态/guardRejected 为零假事件，payload 不含 session secret。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 orchestrator + SQL 行为修复，无 UI、无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: RED-5 要求真 PostgreSQL 集成 + reconcile 回收数验证，走本地 evaluator（curl localhost:5221 + psql）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定 Golden Path step）
