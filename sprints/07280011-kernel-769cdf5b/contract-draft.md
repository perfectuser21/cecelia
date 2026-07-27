# Sprint Contract Draft (Round 1)

## 合同边界

- 本合同只覆盖 Kernel Test Environment Controller 对 `planner/proposer/reviewer/generator/evaluator` 的 attempt 级 PostgreSQL capability 发放、receipt 冻结、pre-import oracle、真实 local/fleet runner 注入与 terminal cleanup；不扩展 judge 或无关 role。
- 本合同不把一次性 fixture `cecelia-harness-test-pg-bootstrap` 固化为长期默认配置、fallback 或提交到仓库的 secret。
- 生产数据库禁止写入；bootstrap/migration/seed 只允许命中 attempt-scoped `TEST_DATABASE_URL`。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A — 本任务无新增 HTTP success/error schema。对外可观测契约是 capability receipt、子进程/容器环境注入、PostgreSQL catalog/oracle 结果与 cleanup 留证。

## 已知约束（来自回归测试）

- `[packages/brain/src/orchestrator/__tests__/dispatcher.test.js]` → `先持久化 attempt，再生成 adapter spec，最后 launch`
- `[packages/brain/src/orchestrator/__tests__/dispatcher.test.js]` → `把 preflight 选中的 target、machine 与同一 fenced receipt 贯穿真实 dispatch 链`
- `[packages/brain/scripts/fleet-worker/attempt-runner.test.cjs]` → `terminal cleanup removes the container before its worktree and state`
- `[packages/brain/scripts/fleet-worker/attempt-runner.test.cjs]` → `persists bounded Attempt state atomically without execution secrets`
- `[packages/brain/scripts/fleet-worker/fleet-worker.test.js]` → `launches an authenticated path-free Attempt and returns a bounded receipt`
- `[packages/brain/scripts/fleet-worker/fleet-worker.test.js]` → `serves authenticated inspect, cancel, and terminal lifecycle routes`
- `[packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js]` → `createAttempt persists the requested machine in both machine columns`
- `[packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js]` → `rejects stale receipt and failure writes from an older generation with the same owner`
- `[累积FR] context-manifest: unavailable`

## 真实调用方请求 shape

真实入口不是新 HTTP 公网接口，而是 Harness server-owned TaskBundle + dispatcher / remote bridge / worker 三段现有生产 shape。合同里的断言与 payload 必须逐字段保持一致：

| 调用方 | 入口 | 关键字段 |
|---|---|---|
| Brain dispatcher | `dispatch('spawn:proposer'|'spawn:reviewer'|'spawn:generator'|'spawn:evaluator', ctx)` | `ctx.runId`、`ctx.hop`、`ctx.observed.task.payload.sprint_dir`、`ctx.observed.task.payload.worktree_path`、`ctx.observed.task.payload.role_assignments` |
| TaskBundle inputs | `bundle.inputs` | `task_id`、`sprint_dir`、`worktree_path`、`contract_round`、`propose_branch`、`contract_branch`、`logical_cycle_id`、新增 `TEST_DATABASE_URL` 注入名与无凭据 receipt 引用 |
| Remote bridge POST | `POST /harness/attempts` | `attempt_id`、`run_id`、`lease_owner`、`lease_generation`、`target.{provider,account,machine,role}`、`workspace_spec`、`provider_spec`、`callback_url`、`callback_token` |
| Fleet worker docker env | `docker create --env` | `TEST_DATABASE_URL`、receipt env/ref、`HARNESS_ATTEMPT_ID`、`HARNESS_RUN_ID`、`HARNESS_LEASE_OWNER`、`HARNESS_LEASE_GENERATION`、`HARNESS_CALLBACK_URL` |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 仅对 server-owned 且声明 DB-backed contract 的 planner/proposer/reviewer/generator/evaluator 命令发放 attempt-scoped PostgreSQL test database 与 short-lived role，并把 `TEST_DATABASE_URL` 与无凭据 receipt 引用精准注入真实 local/fleet runner。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | capability 每个 attempt 只 create/lease 一次；receipt 带 `issued_at/expires_at/nonce/allowed_cidrs/schema_digest`；cleanup/reconcile 在有界时间内完成并留证；重复 cleanup 幂等。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不向 judge/无关 role 注入 URL/receipt；receipt 永不含 URL/password/token；任何 production database、schema、table 权限都必须为零；migration/seed/bootstrap 只命中 `TEST_DATABASE_URL`。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | capability 只对单次 attempt 有效，`expires_at` 到期即失效；cleanup/reconciler 负责回收 role/db/lease 并将 receipt 更新为 terminal outcome。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | dispatcher / worker / recovery 任一路 cleanup 超时、receipt 校验失败或发现跨 attempt 复用时，当前 attempt 必须 fail-closed 并留结构化 receipt/decision 证据供 reviewer 与 judge 核对。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 缺 capability、receipt 校验失败、权限超界、cleanup 失败、worker crash/recovery 未回收时全部 fail-closed；重复 cleanup 可重试且幂等；不允许降级到 caller 自带 `TEST_DATABASE_URL`。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过真实 PG catalog、child/container env、remote worker attempt API、terminal receipt 与登录失败/库不存在断言确认；拿不到 receipt 或 receipt 与 PG 真相不一致即失败。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 哪些 role 可以收到 DB capability | A. 静态 role allowlist；B. 只认 server-owned TaskBundle 声明 `DB-backed contract` | B. 只认 server-owned TaskBundle 声明 | PRD 明禁 caller/task payload/prompt 自带 authority | 错把 judge/无关角色放进能力面，造成凭据泄露或越权写库 |
| ⚠️ pre-import oracle 如何确认“真连的是本 attempt PG” | A. 只比对 URL 字符串；B. 同时校验 `current_database/current_user/inet_server_addr/allowed_cidrs/nonce` | B. 多信号联合校验 | PRD 明确要求独立拒绝 missing/expired/stale/tampered/misdirected/loopback/default socket | 把错误库或生产库当成测试库，直接污染真实数据 |
| ⚠️ cleanup 何时算完成 | A. 子进程退出即完成；B. role 登录失败且 DB/lease 不存在，并持久化 terminal receipt | B. 登录失败 + 库/lease 消失 + attested receipt | PRD 把 success/failure/cancel/kill -9/crash/recovery 全列为强制场景 | 资源泄漏、旧 receipt 复用、跨 attempt 串库 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| DB-backed role 未声明或声明与 role 不符 | 不注入 `TEST_DATABASE_URL` / receipt，命令直接按无 capability 路径执行 | N/A | 无降级，保持最小权限 |
| receipt 缺字段、过期、nonce 复用、CIDR/DB/user 不匹配 | pre-import oracle 立即失败，不跑 migration/seed/bootstrap | 否，receipt 必须重签发 | 无降级 |
| local/fleet runner terminal cleanup 失败 | 标记 `cleanup_outcome=failed`，进入 bounded reconcile | 是，重复 cleanup 幂等 | reconcile 重试，仍失败则 fail-closed |
| worker restart / recovery 后发现 stale receipt | 拒绝 stale receipt，重新核对 PG 与 receipt 真相 | 是 | 无降级 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务只处理 Brain server-owned TaskBundle 与受控 fleet worker 之间的内部链路。

## Golden Path

覆盖父路 Kernel Test Environment Controller 第 1-3 步

[server-owned DB-backed TaskBundle 进入 dispatcher] → [controller 为本 attempt provision/lease 隔离 PG 能力] → [真实 local/fleet runner 收到 `TEST_DATABASE_URL` 与 receipt，执行 pre-import oracle + migration/seed/bootstrap] → [terminal cleanup/reconcile 回收 role/db/lease 并持久化 attested receipt]

### Step 1: 仅 DB-backed proposer/reviewer/generator/evaluator 命令收到 attempt 级 capability

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、范围限定、假设。

**可观测行为**: local dispatcher 真链路只向声明了 DB-backed contract 的 server-owned role 注入 `TEST_DATABASE_URL` 与无凭据 receipt 引用；judge 与无关 role 无该能力。

**验证命令**:
```bash
npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts -t "dispatcher local path injects TEST_DATABASE_URL and credential-free receipt only for DB-backed proposer bundle"
```

**硬阈值**: `TEST_DATABASE_URL` 精确等于本 attempt 隔离库；receipt 至少含 `version/issuer/run_id/attempt_id/task_id/role/contract_sha/execution_surface/database_name/role_name/issued_at/expires_at/nonce/allowed_cidrs/schema_digest/cleanup_outcome/cleanup_at`；JSON 文本不包含 URL/password/token。

### Step 2: 真实 remote bridge -> fleet worker -> attempt runner 把 capability 带进容器环境

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、范围限定、预期受影响文件。

**可观测行为**: 真实 remote worker attempt API 与 attempt runner 路径把 `TEST_DATABASE_URL` 与 receipt 带到 docker create env；migration/seed/bootstrap 只允许命中该 URL。

**验证命令**:
```bash
npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts -t "remote bridge -> fleet worker -> attempt runner carries TEST_DATABASE_URL and receipt into docker create env"
```

**硬阈值**: docker create env 出现 `TEST_DATABASE_URL` 与 receipt/ref；`HARNESS_ATTEMPT_ID/HARNESS_RUN_ID/HARNESS_LEASE_OWNER/HARNESS_LEASE_GENERATION` 与 receipt/PG 真相一致；不向 stdout/receipt 写入 URL/password/token。

### Step 3: pre-import oracle 在真 PG 上证明零生产库权限与正确目标

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2-3 步、边界情况第 4 条、Invariant。

**可观测行为**: 真实 role 连上 attempt 库后，`current_database/current_user/inet_server_addr/allowed_cidrs` 与 receipt 对齐，且对任意非 attempt 数据库没有 `CONNECT/CREATE/TEMP` 或对象权限。

**验证命令**:
```bash
npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts -t "pre-import oracle real PG role has zero CONNECT privilege on non-attempt databases"
```

**硬阈值**: `current_database == receipt.database_name`，`current_user == receipt.role_name`，`inet_server_addr` 非 loopback 且在 `allowed_cidrs` 内；任意非 attempt db 的 `has_database_privilege(...,'CONNECT') == false`。

### Step 4: cleanup/reconcile 在 success/failure/cancel/kill -9/crash/recovery 后回收并留证

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、边界情况第 5 条、E2E 验收点 5。

**可观测行为**: terminal cleanup/reconcile 使旧 role 登录失败、旧库或 lease 消失，并留下不含凭据的 attested receipt；重复 cleanup 仍幂等。

**验证命令**:
```bash
npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts
```

**硬阈值**: terminal 后同 role 登录失败、数据库不存在或 lease 不可见；receipt 中 `cleanup_outcome/cleanup_at` 已填；重复 cleanup 不重新创建库或 role。

## 接缝清单

1. dispatcher ↔ local detached launcher：DB capability 必须在真正的子进程环境中可见，不是只停留在 task payload。
2. remote-bridge transport ↔ fleet-worker.cjs ↔ attempt-runner.cjs：bridge request、worker API、docker create env 三处都要保持同一 attempt capability。
3. controller ↔ PostgreSQL catalog：provision/lease、权限裁剪、cleanup/reconcile 必须在真 PG catalog 上留证。

## 禁 mock 边清单

- dispatcher ↔ `createDetachedLauncher`（本单改 local child env 注入，测试必须真过 launcher 组装）
- remote-bridge transport ↔ `fleet-worker.cjs` ↔ `attempt-runner.cjs`（本单改 fleet capability 注入，测试必须真过 worker attempt API）
- controller 代码 ↔ PostgreSQL catalog（本单改 DB/role 发放与回收，测试必须真 PG 查 `current_database/current_user/has_database_privilege`）
- cleanup/reconcile ↔ receipt persistence（本单改 terminal receipt 语义，测试必须真看 receipt 字段与 cleanup 结果）

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| Windows/self-hosted 真机上的 operator 人工 kill -9 与 worker restart 演练 | proposer 阶段只提交合同与红测，不直接操控生产机 | generator 完成后由 evaluator 在真目标机按合同 E2E 执行 kill/recovery 脚本 |
| 真 merge / 真 deploy / 生产数据库只读巡检 | 明确不在本 sprint 范围内 | 保持禁止 |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}"

npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| local dispatcher capability 注入 | `sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts` | `dispatcher local path injects TEST_DATABASE_URL and credential-free receipt only for DB-backed proposer bundle` | 当前 local launcher env 不含 `TEST_DATABASE_URL` / receipt，命名断言失败 |
| remote bridge + worker + attempt runner capability 注入 | `sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts` | `remote bridge -> fleet worker -> attempt runner carries TEST_DATABASE_URL and receipt into docker create env` | 当前 remote path docker create env 不含 `TEST_DATABASE_URL` / receipt，命名断言失败 |
| pre-import oracle 零生产库权限 | `sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts` | `pre-import oracle real PG role has zero CONNECT privilege on non-attempt databases` | 当前真实 PG 新 role 对非 attempt 数据库仍有 `CONNECT`，命名断言失败 |
