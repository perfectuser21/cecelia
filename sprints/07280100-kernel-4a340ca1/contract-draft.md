# Sprint Contract Draft (Round 1)

contract-gate: active
覆盖父路 Kernel Test Environment Controller Recovery 4 第 1-5 步

## Notes

- authority-base-sha: `274fff5a4a22f3bb3ec5d2d304f3e14bd9aeba71`
- context-manifest: unavailable（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 在 2026-07-27 返回 `Cannot GET`）
- registry freshness: api/db/test registry 最新扫描于 2026-07-18，已过期 217.2h；命名风格仅作参考，PRD 仍为法律
- contract-stage-boundary: 本轮只产合同、DoD、红测与 task-plan；不要求 host Docker Green，也不报告 host-gate pending
- exact-fixture: host/operator 真实 PostgreSQL fixture 固定为 `postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap`
- contract-sha-source: 权威 authority 只允许来自 production `initiative_contracts` ↔ `initiative_runs` 真链路；task payload、bundle、caller env、workspace 文件、provider 输出一律视为不可信

## Response Schema（推导来源: PRD字面）

N/A — 本任务无新增 HTTP 响应。对外可观测契约是 `collectGroundTruth`/controller/runtime 从真实 `initiative_contracts` 与 `initiative_runs` 派生的 authority、CredentialEnvelope/receipt 结构、cleanup 生命周期证据、以及 `review_required=true` 的 host gate 阻断行为。

## 已知约束（来自回归测试）

- `[packages/brain/src/orchestrator/__tests__/attempt-store.test.js]` → `按 run/hop 幂等创建 attempt，并持久化冻结 Skill 元数据`
- `[packages/brain/src/orchestrator/__tests__/attempt-store.test.js]` → `launch receipt requires an explicit non-negative lease generation`
- `[packages/brain/src/orchestrator/credential-broker.test.js]` → `issues one immutable envelope bound to the selected Attempt, account, and machine`
- `[packages/brain/src/orchestrator/remote-bridge-transport.test.js]` → `binds one Codex credential envelope to the selected attempt, account, machine, and deadline`
- `[packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js]` → `report 执行完整收尾链，最后才写 run/task done`
- `[packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js]` → `fences launch receipts by lease owner and active status without mutating rejected writes`
- `[packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js]` → `public watchdog success resumes a new lineage child, never the expired parent`
- `[packages/brain/src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js]` → `persists a reviewer verdict when run_id is a UUID column`
- `[累积FR] context-manifest: unavailable`

## 真实调用方请求 shape

本任务入口不是新 HTTP API，而是 Kernel controller/dispatcher/runtime 的真实调用链。合同内任何 authority、receipt、cleanup 断言都必须沿这个 shape，禁止另造 payload/body/header 双路径：

| 调用方 | 入口 | 关键字段 |
|---|---|---|
| controller 观测层 | `collectGroundTruth(deps,{taskId,runId})` | `initiative_runs.id`、`initiative_runs.contract_id`、`tasks.id`、`tasks.payload.review_required` |
| approved contract 冻结层 | `materializeApprovedContract(db,{runId,version,branch,prdContent,contractContent})` | `initiative_contracts.id/version/status/branch` + `initiative_runs.contract_id` |
| provider-neutral dispatcher | `createDispatcher(...)(action,ctx)` | `ctx.runId`、`ctx.taskId`、`ctx.observed.contract`、`ctx.observed.pr.head_sha`、`ctx.observed.task.payload.review_required` |
| credential 注入链 | `createCredentialBroker.issue(...)` → `createRemoteBridgeTransport.launch(...)` → `packages/brain/scripts/fleet-worker/credential-envelope.cjs` | `attempt_id`、`account_id`、`machine_id`、`issued_at`、`expires_at`、`payload_hash` |
| callback / judge / report | `POST /api/brain/harness/attempts/:attemptId/callback`、`createKernelHandlers().report(ctx)` | `attempt_id`、`decision.outcome`、`failure_class`、`pr.head_sha`、`review_required` |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 基于 frozen contract 真相链解析 authority；在 attempt 持久化后开通 attempt-scoped real PostgreSQL capability；通过 signed non-replayable receipt 证明注入与消费；八终态 cleanup exactly-once；host evaluator 只在 Generator 之后且锚定 Draft PR head SHA。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | fail-closed；真实 PG fixture 可复跑；任何 secret 不进 payload/bundle/logs/git/callback；cleanup 幂等且可 repair/retry。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | `database_backed` 与 environment policy 只从 `initiative_contracts`/`initiative_runs` 派生；不得发明假 `initiative_runs` 列/表；不得把 host Green 前置到 proposer/reviewer 阶段。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | attempt-scoped DB role/db/ACL 与 signed receipt 都受 `expires_at` / lease / PR head 绑定约束；过期后必须失效且不可 replay。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | real PG contract test、callback/judge integration test、host gate smoke 与 cleanup lifecycle test 在 CI/evaluator 中直接暴露失败。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | authority/receipt/cleanup/host-gate 任一点不可信即 fail-closed；cleanup 可 retry/repair 但不重复授予 capability；首次 P0 行为始终 `review_required=true`。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 用 server-side issuance/consumption state、real PG audit、launch/callback/judge/report 结构化结果、以及 exact PR head SHA 绑定证明；拿不到回执即 FAIL。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️authority 是否来自 frozen contract 真相链 | A. 直接信 task payload / env；B. 只信 `initiative_runs.contract_id` → `initiative_contracts` | B. 只信 DB 真相链 | PRD 第 1 步明示 authority 只由 production schema 派生 | payload/env 伪造可越权拿到 DB authority |
| ⚠️receipt 是否可重放 | A. 只看 HTTP 200；B. 校验 canonical bytes、digest、nonce、issued/expires、attempt/run/contract/SHA/DB 全绑定 | B. 全绑定校验 | PRD 第 3 步明示 reject replay/forge/cross-attempt reuse | 旧 capability 被跨 attempt 复用，形成越权 |
| ⚠️cleanup 是否真的安全完成 | A. 只看 handler 返回 ok；B. 真查 login/DB/ACL/envelope/secret file/replay capability 残留 | B. 真查残留 | PRD 第 4 步明示“无 surviving login/DB/ACL/envelope/secret file” | 残留 capability 继续可用，P0 安全行为失真 |
| ⚠️host evaluator gate 何时允许 merge | A. evaluator 一回调就 merge；B. 仅在 Generator 之后、exact Draft PR head receipt 匹配、owner review 明确通过后 merge | B. exact head + owner review | PRD 第 5 步明示 Draft PR + human authority | 错误 SHA、陈旧 receipt 或未审核 PR 被提前合并 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| authority 无法从 `initiative_contracts`/`initiative_runs` 解析 | 阻断 provisioning 与 launch | 是 | 人工修复 run/contract 真相链 |
| CredentialEnvelope/receipt 缺字段、签名错、digest 错、时间错、DB 绑定错 | 直接拒绝消费/回调 | 是 | 无降级；重新签发全新 envelope/receipt |
| cleanup 任一路径未确认安全 | 保持失败态并记录 lifecycle/cleanup 细节 | 是 | 走 repair/retry，不得重放旧 capability |
| host evaluator receipt 缺 exact Draft PR head SHA 或 review_required 未批准 | `report`/merge 阻断 | 是 | 等待 evaluator 重跑或 owner review |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务只处理 Brain 内部 harness/runtime authority，不新增外部可写 agent 输入面。

## Golden Path

[真实 run/contract 权威链] → [attempt 持久化后 provisioning 真 PG capability] → [signed receipt/credential 注入与消费不可重放] → [八终态 cleanup exactly-once 回收] → [Generator 之后 exact Draft PR head host gate + owner review]

### Step 1: frozen contract authority 只能来自 `initiative_contracts` ↔ `initiative_runs`

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、范围限定、边界情况。

**可观测行为**: controller/runtime 从真实 `initiative_runs.contract_id` 读取 approved contract authority；task payload、bundle、env 中伪造的 `database_backed/DB_URL/contract_sha` 不会放大权限。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}" \
npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts -t "collectGroundTruth 只从 initiative_contracts 与 initiative_runs 派生 authority"
```

**硬阈值**: exit code = 0；`observed.contractAuthority.database_backed === true`；`contract_id/run_id/contract_sha` 来自 real PG；payload 中覆盖值被忽略。

### Step 2: attempt 持久化后才允许 provisioning attempt-scoped PostgreSQL capability

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、预期受影响文件。

**可观测行为**: 只有真实 `harness_attempts` 行落库后，controller 才创建 attempt-scoped DB/role/ACL；`DB_NAME/DB_URL` 只经 trusted launcher 或 CredentialEnvelope remote path 注入，且带 task/run/attempt/contract/SHA 绑定。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}" \
npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts -t "attempt 持久化后才允许 provisioning real PG capability"
```

**硬阈值**: exit code = 0；未持久化 attempt 时 provisioning 明确失败；成功路径返回受绑定的 `db_name/db_url` 元数据；不写 secret 到 bundle/log/result。

### Step 3: CredentialEnvelope 与 remote bridge receipt 必须是 signed non-replayable envelope

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、范围限定。

**可观测行为**: broker/transport/worker 使用 `signed_payload + signature + key_id + algorithm + payload_digest + nonce + issued_at + expires_at`；任何 replay、wrong key/digest、wrong attempt/run/contract/SHA/DB、stale/future timestamp、DB override 都被拒绝。

**验证命令**:
```bash
npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs \
  sprints/07280100-kernel-4a340ca1/tests/credential-envelope-receipt.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/remote-bridge-receipt.contract.test.ts
```

**硬阈值**: exit code = 0；envelope/launch body 含全部签名绑定字段；变异 `attempt_id/run_id/contract_id/contract_sha/pr_head_sha/db_name/nonce/payload_digest` 任一项都单独 FAIL。

### Step 4: cleanup 对八条终态路径 exactly-once 回收 capability

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步、边界情况、NFR。

**可观测行为**: `completed`、`completed_with_concerns`、`failed callback`、`cancelled`、`timeout`、`lease expiry`、`process/worker death`、`callback auth/validation rejection` 八条终态都走 revoke/disconnect/drop，并可 repair/retry 但不重复授权。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}" \
npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts -t "cleanup 覆盖八条终态并要求无残留 capability"
```

**硬阈值**: exit code = 0；八终态常量完整；重复 cleanup 只产生一次 terminal cleanup evidence；真查无残留 login/DB/ACL/envelope/secret file/replay capability。

### Step 5: host evaluator gate 只能在 Generator 之后、exact Draft PR head SHA 与 owner review 通过后放行

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步、Human authority。

**可观测行为**: `createKernelHandlers().report(ctx)` 在 `review_required=true` 且缺 exact Draft PR head host receipt / owner review 时必须阻断；Judge 只消费同一 receipt；proposer/reviewer 阶段不要求 host Green。

**验证命令**:
```bash
npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts -t "report 在 exact Draft PR head host receipt 与 owner review 缺失时必须阻断"
```

**硬阈值**: exit code = 0；无匹配 receipt 或 `review_required=true` 未批准时返回 `BLOCKED`；只有 exact `pr.head_sha` + owner review 显式通过后才允许 `DONE`。

## 接缝清单

1. `collectGroundTruth` / runtime ↔ `initiative_runs` + `initiative_contracts`：权威 authority 必须真查 production schema。
2. `createCredentialBroker` ↔ `createRemoteBridgeTransport` ↔ `packages/brain/scripts/fleet-worker/credential-envelope.cjs`：签名 envelope 与 receipt 必须跨模块逐字段一致。
3. controller cleanup ↔ real PostgreSQL login/DB/ACL + callback/judge/report：exactly-once 回收与 host gate 必须在真状态上执法。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/ground-truth.js` ↔ `initiative_runs` / `initiative_contracts`（本单改 authority 读取，测试必须真 PG）
- `packages/brain/src/orchestrator/credential-broker.js` ↔ `packages/brain/src/orchestrator/remote-bridge-transport.js` ↔ `packages/brain/scripts/fleet-worker/credential-envelope.cjs`（本单改 envelope/receipt 绑定，测试必须真调相邻模块）
- controller cleanup 代码 ↔ real PostgreSQL capability 残留审计（本单改 revoke/drop 路径，测试必须真查 PG）
- `packages/brain/src/orchestrator/kernel-handlers.js` ↔ `review_required` / host evaluator receipt gate（本单改 report 阶段门，测试必须真调 handler）

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| 第三方签名 key 的真实 HSM / KMS 托管 | 当前仓库未暴露生产 key 服务，合同阶段只能冻结签名字段与验证顺序 | Generator 完成后由 host evaluator 用真实 key/fixture 跑一次 receipt 正反例 |
| 真机/远端 worker 上的 DB allow-list 实网 CIDR 发现 | proposer 阶段只产 Red 合同，不部署远端网络策略 | Evaluator 在 host/operator Docker + worker 环境执行 exact Draft PR head receipt 审计 |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}"

psql "$TEST_DATABASE_URL" -c "select current_database() as db, now() as ts" >/tmp/kernel-controller-fixture.txt
grep -q "harness_controller_bootstrap" /tmp/kernel-controller-fixture.txt

npx vitest run \
  --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs \
  sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/credential-envelope-receipt.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/remote-bridge-receipt.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| frozen-contract authority + provisioning real PG | `sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts` | `collectGroundTruth 只从 initiative_contracts 与 initiative_runs 派生 authority` / `attempt 持久化后才允许 provisioning real PG capability` | 当前 `collectGroundTruth` 不返回 `contractAuthority`，也没有 provisioning controller；断言在真实 PG schema 上失败而不是测试崩溃 |
| signed CredentialEnvelope | `sprints/07280100-kernel-4a340ca1/tests/credential-envelope-receipt.contract.test.ts` | `CredentialEnvelope 必须带 signed_payload 外层签名与全绑定字段` | 当前 broker 只返回 `payload/payload_hash`，缺 `signed_payload/signature/key_id/nonce/contract_sha/db_name`，断言失败 |
| remote bridge signed receipt | `sprints/07280100-kernel-4a340ca1/tests/remote-bridge-receipt.contract.test.ts` | `remote bridge launch body 必须携带 exact signed receipt 绑定字段` | 当前 launch body 没有 `signed_payload/payload_digest/contract_id/contract_sha/pr_head_sha/db_name`，fetch payload 断言失败 |
| cleanup + host evaluator gate | `sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts` | `cleanup 覆盖八条终态并要求无残留 capability` / `report 在 exact Draft PR head host receipt 与 owner review 缺失时必须阻断` | 当前缺八终态 cleanup contract 常量/控制器，且 `report(ctx)` 在缺 host receipt 时仍会继续 DONE，断言失败 |
