# Sprint Contract Draft (Round 1)

contract-gate: active
覆盖父路 Harness V5 DB bootstrap 第 1-4 步

## Notes

- context-manifest: unavailable
- registry freshness: api/db/test registry 最新扫描于 2026-07-18，已过期约 216h；仅用于命名风格参考，PRD 仍为法律。
- contract-gate: active
- red-evidence: 本轮 Red 只接受命名业务断言失败；不接受缺 env、缺网络、缺 import 路径、缺权限伪装成 Red。
- database-capability: `TEST_DATABASE_URL` 只能作为 execution environment capability 注入，禁止进入 task payload、prompt、git、stdout、callback、result、decision log 或普通日志。
- local-fleet-parity: local-docker 与 fleet-worker 必须走真实 dispatcher/transport/attempt-runner 路径，不接受 caller env forwarding、mock pool、source grep 或 synthetic URL。

## Response Schema（推导来源: [PRD字面]）

N/A - 本任务聚焦 Kernel/Engine/Brain 的测试数据库能力、bootstrap、cleanup 与 receipt 合同，不新增对外 HTTP response schema。

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/db-config-guard.test.js] -> `NODE_ENV=test` 时禁止 `DB_NAME=cecelia`，测试库默认 `cecelia_test`
- [packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js] -> fleet receipt 需要真实 PostgreSQL、真实 migration 与 `local-docker|remote-bridge` 运输枚举
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] -> Kernel wiring 需要真实隔离数据库、真实 dispatcher 与真实 PG 写路径
- [packages/engine/tests/skills/harness-v5-ci-checks.test.ts] -> sprint tests workflow 当前显式传 `TEST_DATABASE_URL`，并校验 `cecelia_test`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 为每次 DB-backed Harness attempt 创建或租用 attempt 级测试数据库能力，只把 `TEST_DATABASE_URL` 暴露给声明 DB-backed B1-B5 的执行命令；bootstrap/migration/seed/Brain/Vitest 全部严格消费同一连接串；finally 回收短期 role/lease 并生成无凭据 attested receipt。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | capability 必须短期有效、跨 attempt 不可复用、失效后立即 fail closed；local-docker 与 fleet-worker 表现一致；cleanup 在 success/failure/cancel/crash/recovery 后都执行。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不改生产 Golden Path；不新增 migration；不触碰生产数据库；不在生产模块 import 里改 env / spawn `psql` / 隐式迁移；数据库凭据绝不出现在日志、payload、callback、result、decision log。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | `TEST_DATABASE_URL` capability 由 attempt receipt 绑定 expiry；过期后下一次使用前必须 fail closed；cleanup 负责 role/db/lease 退役。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | Kernel PG integration、sprint contract tests 与 fleet/local parity regression 在 CI 内发现；receipt/cleanup 失败会在 attested receipt 和 contract tests 中显式失败。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 缺 capability、过期、跨 attempt、loopback/default socket、生产库权限、receipt 陈旧或 cleanup 失败时一律 fail closed；不降级到 `DB_NAME`/`DATABASE_URL`/默认 socket。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过真实 bootstrap 观察 `current_database()`、`inet_server_addr()`、`journey_step_links`、role privilege、receipt payload 与 cleanup outcome；拿不到 attested receipt 视为失败。 |

### 判定点登记表（对模糊现实的判断假设 - decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ local-docker 与 fleet-worker 是否真的使用同一类 DB capability | A. 只比对 env 文本; B. 真实 dispatcher/transport/attempt-runner 回执对账 | B. 真实 dispatcher/transport/attempt-runner 回执对账 | PRD 明确禁止 caller env forwarding / synthetic URL | 伪装 parity，真机 worker 上 capability 断裂 |
| ⚠️ capability 是否指向“可信隔离 PG”而非 loopback/default socket | A. 只看库名后缀; B. 同时校验 `current_database()`、`inet_server_addr()`、allowed CIDR、非默认 socket | B. 同时校验四项 | 仅看库名无法挡住误连本地/生产 | 测试写入落错库，甚至命中生产 |
| ⚠️ cleanup 是否真正完成 | A. 仅看 finally 代码执行; B. receipt 绑定 cleanup outcome + 后续复用失败 | B. receipt 绑定 cleanup outcome + 后续复用失败 | PRD 要求 kill/crash/recovery 后仍可证明回收 | 僵尸角色/租约残留，可跨 attempt 复用 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| capability 缺失或 role 不应持有 capability | 在 Brain import 前拒绝执行 | 是 | 无；直接 FAIL |
| capability 过期 / 跨 attempt / receipt 陈旧 | 在首次消费前拒绝执行 | 是 | 无；直接 FAIL |
| capability 指向 loopback/default socket/生产库/无 allowed CIDR | 在 bootstrap 前拒绝执行 | 是 | 无；直接 FAIL |
| runner 被 kill 或 recovery 触发 | finally/recovery 清理短期 role、lease、db，并记录 cleanup outcome | 是 | 不允许保留可复用 capability |
| bootstrap/migration/seed 目标库不一致 | 命名业务断言失败，明确指出 `current_database()` 或 `journey_step_links` 不符合合同 | 是 | 不回退到 `DB_NAME` / alias |

### 输入对抗面（对外暴露 agent 必填 - decisions 27b57469 第9要素）

N/A - 本任务不新增对外暴露 agent 输入面；输入仅限 Kernel/Engine 内部 execution capability。

## Risks

| 风险 | 机械缓解 | 验收证据 |
|---|---|---|
| 旧 workflow 或 helper 继续走 `DB_NAME=cecelia` | 统一 `TEST_DATABASE_URL` 为唯一测试连接串，旧 alias 只允许 workflow/helper 映射 | 负例 contract test 命名断言旧 workflow 失败 |
| 生产模块 import 偷改 env / spawn psql / 隐式迁移 | import-purity 回归在 PATH 无 `psql`、仅设 `TEST_DATABASE_URL` 下执行 | import-purity contract test |
| judge/无关角色拿到 DB capability | dispatcher/requirements 按角色白名单发放 | capability routing contract test |
| local/fleet 只在 caller env 看起来一致 | 必须通过真实 dispatcher/transport/attempt-runner 验收 receipt | parity contract test |
| cleanup 做了但无法证明 | receipt 绑定 run_id/attempt_id/execution_surface/db/expiry/cleanup outcome 且不含凭据 | receipt contract test |

## 真实调用方请求 shape

### Execution capability: `TEST_DATABASE_URL`

- 载体: execution environment capability，仅在 runner 进程环境注入
- 可见角色: planner/proposer/reviewer/generator/evaluator 中声明 DB-backed B1-B5 的命令
- 禁止角色: judge 与无关 role 一律不可见
- 关键字段:
  - `TEST_DATABASE_URL=postgresql://<short-lived-role>:<secret>@<non-loopback-host>:<port>/<attempt_db>`
  - `HARNESS_DB_RECEIPT=<signed-json-or-path>`
  - `HARNESS_DB_EXPIRY=<ISO8601>`
  - `HARNESS_EXECUTION_SURFACE=local-docker|fleet-worker`
- 契约要求: 业务代码不得从 body/payload/prompt/git/stdout 读取该 capability；只允许从执行环境读取；bootstrap/Brain/Vitest 必须逐字段使用这一 shape，不得切回 `DB_NAME` / `DATABASE_URL` / default socket 双路径。

## 接缝清单

- dispatcher/preflight requirements ↔ execution capability routing：只有声明 DB-backed B1-B5 的角色拿到 capability，judge 与无关角色拿不到
- bootstrap/migrate/seed/Vitest ↔ PostgreSQL 真库：必须都打到同一个 `TEST_DATABASE_URL` 指向的 attempt 测试库
- runner finally/recovery ↔ role/db/lease cleanup：kill/crash/recovery 后仍要回收并写 receipt
- receipt attestation ↔ production transport：local-docker 与 fleet-worker 需要真实 transport 生成可验证 receipt

## 禁 mock 边清单

- `packages/brain/src/orchestrator/dispatcher.js` ↔ preflight capability routing（本单改 execution capability 发放，测试必须真调相邻 routing 逻辑）
- Kernel runner / fleet transport ↔ receipt persistence（本单改 local/fleet receipt 与 cleanup 契约，测试必须真调 receipt 读写路径）
- bootstrap helper ↔ PostgreSQL target database（本单改 bootstrap/migration/seed 的写路径，测试必须真 PostgreSQL 断言 `current_database()` 与 `journey_step_links`）
- production module import ↔ process env / child_process（本单改 import purity 守卫，测试必须真观察 env mutation 与 spawn）

## 未覆盖真实链路清单

(本合同无 mock 豁免，N/A)

## Golden Path

[入口：dispatcher 为一次 Harness attempt 发放隔离测试数据库 capability] -> [bootstrap/migration/seed/Brain/Vitest 全部严格消费同一个 TEST_DATABASE_URL] -> [生产模块 import 保持纯净，非法 capability 在 Brain import 前 fail closed] -> [attempt 结束后 cleanup + attested receipt 证明 local/fleet parity]

### Step 1: 为 DB-backed Harness attempt 发放 attempt 级 `TEST_DATABASE_URL` capability
**来源**: `[FROM_PRD]` - PRD 核心场景第 1 步。

**可观测行为**: 只有声明 DB-backed B1-B5 的命令拿到 `TEST_DATABASE_URL`；judge 和无关角色拿不到；capability 绑定 run/attempt/surface/expiry。

**验证命令**:
```bash
npx vitest run \
  sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts \
  -t 'DB capability 只发给声明 DB-backed B1-B5 的角色' --reporter=verbose
```

**硬阈值**: proposer/planner/reviewer/generator/evaluator 的 DB-backed 命令可见 capability；judge 与无关角色不可见；任何 payload/prompt/log 渗漏都视为失败。

---

### Step 2: bootstrap 只显式迁移 `TEST_DATABASE_URL` 指向的白名单测试库
**来源**: `[FROM_PRD]` - PRD 核心场景第 2 步。

**可观测行为**: bootstrap 后 `current_database()` 与 capability 中库名一致，`journey_step_links` 存在，service/migration/seed/Brain/Vitest 使用同一连接串；旧 workflow 在同夹具上以命名业务断言失败。

**验证命令**:
```bash
npx vitest run \
  sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts \
  -t 'bootstrap 只迁移 TEST_DATABASE_URL 白名单库|旧 workflow 使用 DB_NAME=cecelia 在共享夹具上命名失败' --reporter=verbose
```

**硬阈值**: 不允许 `DB_NAME` / `DATABASE_URL` / alias 决定目标库；`journey_step_links` 缺失或库名不一致即失败。

---

### Step 3: 生产模块 import 保持纯净，非法 capability 在 Brain import 前 fail closed
**来源**: `[FROM_PRD]` - PRD 核心场景第 3 步。

**可观测行为**: `kernel-harness-f1-baseline` 或等价生产模块 import 不改 env、不 spawn `psql`、不隐式迁移；缺失/过期/跨 attempt/loopback/default socket/生产库/default socket capability 会在 Brain import 前被拒绝。

**验证命令**:
```bash
npx vitest run \
  sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts \
  -t 'import kernel-harness-f1-baseline 不改 env 不 spawn psql 不隐式迁移|缺失过期跨 attempt loopback production capability 在 Brain import 前 fail closed' --reporter=verbose
```

**硬阈值**: PATH 无 `psql` 且仅设置 `TEST_DATABASE_URL` 时 import 仍纯净；任何非法 capability 在 import 前失败，不允许先写库后报错。

---

### Step 4: finally/recovery 回收短期 role 与数据库租约，并产出不含凭据的 attested receipt
**来源**: `[FROM_PRD]` - PRD 核心场景第 4 步。

**可观测行为**: success/failure/cancel/crash/recovery 后 cleanup 都执行；receipt 绑定 `run_id/attempt_id/execution_surface/database_name/expiry/cleanup_outcome`，不含 credential；local-docker 与 fleet-worker 真实路径对等。

**验证命令**:
```bash
npx vitest run \
  sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts \
  -t 'kill recovery cleanup 后拒绝复用旧 capability|local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等' --reporter=verbose
```

**硬阈值**: cleanup outcome 必须可验证；陈旧 receipt、跨 attempt receipt、cleanup 后复用 capability 一律失败；receipt 中不得出现连接串或密码。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

: "${TEST_DATABASE_URL:?必须由 evaluator 注入 attempt 白名单测试库}"

DB_NAME="$(node -e "const u=new URL(process.env.TEST_DATABASE_URL); const db=u.pathname.slice(1); if(!/(^|_)(test|scratch)(_|$)|_test$|_scratch$/.test(db) || db==='cecelia'){throw new Error('unsafe_db:'+db)} process.stdout.write(db)")"

START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

npx vitest run \
  sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts \
  sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts \
  --reporter=verbose

psql "$TEST_DATABASE_URL" -tAc "SELECT current_database()" | grep -Fx "$DB_NAME"
psql "$TEST_DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='journey_step_links'" | grep -Fx '1'
psql "$TEST_DATABASE_URL" -tAc "SELECT inet_server_addr() IS NOT NULL" | grep -Fx 't'

echo "OK: ${DB_NAME} bootstrap receipt contract verified since ${START_TS}"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| capability 路由与 import purity | `sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts` | `DB capability 只发给声明 DB-backed B1-B5 的角色`; `import kernel-harness-f1-baseline 不改 env 不 spawn psql 不隐式迁移`; `缺失过期跨 attempt loopback production capability 在 Brain import 前 fail closed` | 当前实现仍存在 `DB_NAME`/`DATABASE_URL` 回退、缺 capability 路由与 import-purity 守卫，Vitest 断言失败 |
| bootstrap / cleanup / parity | `sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts` | `bootstrap 只迁移 TEST_DATABASE_URL 白名单库`; `旧 workflow 使用 DB_NAME=cecelia 在共享夹具上命名失败`; `kill recovery cleanup 后拒绝复用旧 capability`; `local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等` | 当前仓库未提供统一 bootstrap/controller/receipt 契约，Vitest 断言失败 |
