# Sprint Contract Draft（Round 1）

## 合同 notes

- 基线：`origin/main` `274fff5a4a22f3bb3ec5d2d304f3e14bd9aeba71`；本轮 PRD commit `3455d0a6cb1ebbb270b64f65795e766e7058c228`。历史 proposer `565885a3146d4726b98b2ef070e38dd9fb005a98` 与 reviewer attempt `b3b531d1-eea5-4408-8457-ad23eb5080dd` 仅是拒绝证据，任何 receipt/approval 均失效。
- `api_registry/db_schema/test_registry` 已读取（50/50/30 项）；未发现本能力既有 API/DB/test pattern，因此新增 controller/receipt schema 标 `[NEW_PATTERN]`，attempt 生命周期沿用 `harness_attempts` 的 `queued/starting/running/completed/completed_with_concerns/needs_context/blocked/failed/cancelled`。
- `context-manifest: unavailable (HTTP 404)`；PRD 的累积 FR 明示为空。
- PRD 所称 `kernel-harness-f1-baseline` 在 `origin/main`、三个 registry 均无同名字面实体。合同以当前真实生产入口 `packages/brain/src/orchestrator/run.js` 作为可执行 consumer（其 `buildRealDeps` 组装 dispatcher/transport，`parseArgs` 可语义执行），禁止 Generator 发明 facade。若人类指的是另一实体，审批前必须提供 commit/path 并修订本合同。
- `contract-gate: enabled (packages/brain/src/lib/contract-gate.js exists)`。
- `judgment-pending-user: ⚠️ 终态 receipt 的真实性权威`——本合同选择 server signing key 的 canonical HMAC 作为权威，host operator receipt 另由 operator key 签名；若已有组织级 KMS 规则，批准前替换算法与 key id。
- Docker-only 接缝在同一 proposer SHA 的 host receipt 出现前一律为 `logic-done-pending`。PR 保持 Draft；本角色不 merge/deploy。

## Response Schema（推导来源: PRD字面 + NEW_PATTERN）

本 Sprint 不新增 HTTP 业务端点，生产 transport 使用现有 authenticated Worker Attempt API；对外业务 HTTP response schema 为 `N/A — 任务无新增 HTTP 响应`。

内部 public receipt 是固定字段白名单（不是 TaskBundle 字段）：

```json
{
  "version": "harness-db-receipt/v1",
  "issuer": "cecelia-brain",
  "run_id": "uuid",
  "attempt_id": "uuid",
  "task_id": "uuid",
  "role": "generator",
  "contract_sha": "40-hex",
  "execution_surface": "local-docker",
  "database_name": "harness_attempt_<uuid>",
  "role_name": "harness_role_<uuid>",
  "issued_at": "RFC3339",
  "expires_at": "RFC3339",
  "nonce": "opaque-random",
  "allowed_cidrs": ["192.168.215.2/32"],
  "schema_or_migration_digest": "sha256:<64hex>",
  "cleanup_outcome": null,
  "cleanup_at": null,
  "canonicalization": "JCS-RFC8785",
  "signature": {"algorithm":"HMAC-SHA256","key_id":"server-owned:<id>","value":"base64url"},
  "digest": {"algorithm":"SHA-256","value":"hex"}
}
```

严格性：顶层 keys 与 `signature`/`digest` 子 keys 必须完全相等；未知字段拒绝。receipt 永不含 URL、password、token、secret。terminal receipt 仍是同一 schema，只把 `cleanup_outcome` 置为 `cleaned|already_clean|cleanup_failed_closed` 并写 `cleanup_at`，重新 canonicalize/sign/digest。

## 真实调用方请求 shape

来源为当前生产代码：

- Dispatcher → local launcher：`createDispatcher` 调 `launcher.launch({attempt,bundle,spec,adapter,task,target,leaseClaimed:true,testEnvironmentCapability})`。新增字段仅存在于进程内；`bundle/task/spec` 都不含 capability。
- Dispatcher → remote transport：`createRemoteBridgeTransport.launch` 的内部参数带 `testEnvironmentCapability`；authenticated `POST /harness/attempts` body 顶层新增 `test_environment_capability`。它不得进入 `provider_spec`、`workspace_spec` 或 TaskBundle。
- Worker → attempt-runner：`fleet-worker.cjs` 验 bearer 后把已验签 capability 作为单独内部参数交给 `attempt-runner.cjs`；`PROVIDER_FIELDS` 仍固定 `provider/command/args/stdin/output`，禁止借 `provider_spec.env` 绕行。
- Runner → actual child/container：仅真实 runner env 注入 `TEST_DATABASE_URL=<瞬态URL>` 与 `HARNESS_DB_RECEIPT=<无凭据receipt JSON>`。现状 Red：`PROVIDER_FIELDS` 无 env、remote bridge 丢 capability、`envArgs` 无两项。

认证/关键字段逐字：

| 边 | 认证 | 必填绑定 |
|---|---|---|
| Brain → Worker | `Authorization: Bearer <server-owned worker token>` | attempt_id/run_id/task_id/role/contract_sha/execution_surface/lease_generation |
| Worker → capability validator | receipt canonical signature + digest | attempt/run/task/role/surface/database/user/CIDR/expiry/nonce |
| Runner child → PostgreSQL | URL 内随机 attempt role credential（仅内存/env） | current_database/current_user/server CIDR 与 receipt 一致 |

## 已知约束（来自回归测试与累积 FR）

- `[packages/brain/src/orchestrator/__tests__/dispatcher.test.js]` → current dispatcher 先 `attemptStore.createAttempt` 再 claim/launch；bundle 与 persisted attempt 同源。
- `[packages/brain/src/orchestrator/remote-bridge-transport.test.js]` → provider_spec 严格白名单且 authenticated HTTP response attestation 必验。
- `[packages/brain/scripts/fleet-worker/attempt-runner.test.cjs]` → credential consume → workspace prepare → Docker launch，state 持久化只保存 metadata；terminal/reconcile 拥有真实 cleanup 顺序。
- `[packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js]` → 集成测试显式读取 `TEST_DATABASE_URL`，不得默认生产库。
- `[packages/brain/src/__tests__/integration/migration-349.integration.test.js]` → `journey_step_links` 是现有 V5 合同表，不得平行建表。
- `[累积FR]` → 本 line 暂无历史。
- `context-manifest: unavailable`。

## Golden Path

独立小路（无父路）

[冻结合同 + persisted attempt] → [server-owned provision] → [签名 receipt] → [local/fleet 瞬态传输] → [真实 PG pre-import oracle] → [V5/import purity] → [八终态 cleanup] → [结构化 callback + host receipt gate]

### Step 1：先持久化 attempt，再由 server-owned facts 判定资格

**来源**: `[FROM_PRD]` — Golden Path 第 1 步、范围“server-owned 资格判定”。

**可观测行为**: 真实 `harness_attempts` 行先存在；只有冻结合同 row 中对应 role command 的 `database_backed=true` 才签发 capability。payload/prompt/TaskBundle/git/stdout 的同名字段无权，judge/reporter/无关命令无 capability。

**验证命令**:

```bash
cd packages/brain
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?operator 必须显式注入 bootstrap URL}"
npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js \
  -t '合格 DB-backed generator 在 attempt 持久化后获得 server-owned 瞬态 capability|调用方 payload 的 URL、receipt、database、role、nonce、CIDR 全部无权且不持久化|judge 与无关 reporter 不获得 URL 或 receipt' \
  --reporter=verbose
```

**硬阈值**: 3 个独立测试 exit 0；资格事实只从同一 transaction 可读的 frozen contract row 获取；attempt create 发生在 provision 前；零 caller authority。

**Red / counterfactual / restore / Green**:

- Red：上述命令在基线精确失败 `BUSINESS_RED: dispatcher 未签发 server-owned capability`。
- Counterfactual：保留冻结合同为 DB-backed，仅在 task payload 写攻击 URL/receipt/capability；必须仍使用 server-owned 值。
- Restore：删除攻击 payload 字段后重跑正路。
- Green：三项独立 test exit 0，并输出无凭据 receipt digest。

---

### Step 2：为每个 attempt 创建唯一最小权限 DB/role/nonce

**来源**: `[FROM_PRD]` — Golden Path 第 2 步。

**可观测行为**: 工厂只接收 trusted admin pool/control-plane config、receipt store、signing key、clock 与 server contract facts。每个 attempt 创建/租赁恰好一个 `harness_attempt_<uuid>` 与 `harness_role_<uuid>`，随机 secret、`VALID UNTIL`、nonce。创建 production-named decoy 后，attempt role 对所有非 attempt DB 以及 schema/table/sequence/function 的 CONNECT/CREATE/TEMP/object privilege 均为零；attempt DB 仅有 migration/seed/test 所需权限。

**验证命令**:

```bash
cd packages/brain
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}"
npx vitest run src/__tests__/integration/test-environment-controller.pg.integration.test.js \
  -t '每个 attempt 唯一 database role nonce|非 attempt 与 production decoy 零 database schema table sequence function privilege|仅 attempt schema 可 migration seed test' \
  --config vitest.integration.config.js --reporter=verbose
```

**硬阈值**: 两 attempt 的 DB/role/nonce 三元组全不同；`has_database_privilege` 的 CONNECT/CREATE/TEMP 全 false；information_schema/ACL 的对象 privilege count=0；有效期 `expires_at-issued_at <= 30m` 且 `VALID UNTIL=expires_at`。

---

### Step 3：固定 receipt schema，严格 canonicalize/sign/digest/anti-replay

**来源**: `[FROM_PRD]` — Golden Path 第 3 步与全部 receipt 反例。

**可观测行为**: receipt 严格白名单；JCS-RFC8785 canonical bytes → SHA-256 digest → server-owned HMAC-SHA256 signature。validator 逐项绑定并原子消费 nonce。缺 receipt、过期、stale/reused nonce、cross-attempt、未知字段、body/signature/digest 篡改各自命名失败且不消耗合法 nonce。

**验证命令**:

```bash
cd packages/brain
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}"
npx vitest run src/__tests__/integration/test-environment-receipt.pg.integration.test.js \
  --config vitest.integration.config.js --reporter=verbose
```

**硬阈值**: receipt 顶层/子层 keys 完全等于本合同 schema；14 个 receipt 反例各有独立 `it()`、独立 restore、唯一 error code；并发消费同 nonce 恰好 1 成功，其余 `receipt_nonce_reused`；任何持久化 JSON/日志中 secret-pattern 命中数=0。

---

### Step 4：仅真实 local child 或 authenticated fleet runner 获得环境

**来源**: `[FROM_PRD]` — Golden Path 第 4 步。

**可观测行为**: local capability 仅是 launcher 内部参数；fleet capability 仅在 authenticated POST 顶层，worker 验全部绑定后才交 runner；实际容器 env 恰有 `TEST_DATABASE_URL` 与 credential-free `HARNESS_DB_RECEIPT`。TaskBundle/provider_spec/persisted state/result/log/callback/artifact 无 secret；judge/unrelated role 无两 env。

**验证命令**:

```bash
cd packages/brain
npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js \
  -t 'authenticated server-to-worker POST 携带 capability，TaskBundle/provider_spec 均不携带' \
  --reporter=verbose
```

**硬阈值**: 真实 HTTP test exit 0；request auth 精确 Bearer；capability 不在 provider_spec/workspace_spec；Docker-only 注入仍需 Step 8 host receipt，未有 receipt 时状态=`logic-done-pending`。

---

### Step 5：DB consumer 导入前执行真实 PostgreSQL oracle

**来源**: `[FROM_PRD]` — Golden Path 第 5 步。

**可观测行为**: 在 import 前用 controller-issued URL 真连 PG，逐字核对 current_database/current_user；`inet_server_addr()` 必须非 null、非 loopback、在 receipt CIDR；catalog/ACL 对非 attempt/production name/host/privilege fail-closed。

**验证命令**:

```bash
cd packages/brain
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}"
npx vitest run src/__tests__/integration/test-environment-oracle.pg.integration.test.js \
  --config vitest.integration.config.js --reporter=verbose
```

**硬阈值**: missing URL/receipt、ambiguous host、misdirected DB、loopback、default socket、production name/host/privilege、CIDR mismatch 各自独立 test exit 0（即正确拒绝）；正路 oracle 在 import 前写 credential-free evidence。

---

### Step 6：V5 migration/seed 与真实 baseline import purity

**来源**: `[FROM_PRD]` — Golden Path 第 6 步。

**可观测行为**: migration/seed/bootstrap 只接受 controller-issued `TEST_DATABASE_URL`；同一连接证明 current_database=receipt database 且 `journey_step_links` 存在并可 seed/rollback。`DB_NAME=cecelia` 与缺 URL 各自 fail-closed。真实 `orchestrator/run.js` consumer 在无 psql PATH 下 import + `parseArgs` 语义运行，catalog/env/process 不变。

**验证命令**:

```bash
cd packages/brain
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}"
npx vitest run src/__tests__/integration/test-environment-v5.pg.integration.test.js \
  --config vitest.integration.config.js --reporter=verbose
npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js \
  -t '无 psql PATH 导入真实 orchestrator/run.js 时 catalog、env 与进程语义不变' \
  --reporter=verbose
```

**硬阈值**: V5 正路 + old DB_NAME + missing URL 三个独立 test 全 exit 0；同一 attempt DB 中 `to_regclass('public.journey_step_links')` 非 null；import purity test exit 0；Brain `DEFINITION.md` version 递增且 consumer semantic test 真调用 `parseArgs`。

---

### Step 7：八种终态真实 cleanup、幂等、bounded fail-closed reconcile

**来源**: `[FROM_PRD]` — Golden Path 第 7 步。

**可观测行为**: success/failure/cancel/SIGKILL/runner crash/worker restart/recovery/reconcile 各自真实执行；终态先 terminate sessions，再 revoke role/drop DB或lease，最后持久化签名 terminal receipt。旧 URL 登录失败、DB/role/lease 均不存在；重复 cleanup 返回 already_clean 且不复建。timeout/reconcile 最多 30s，失败状态 `cleanup_failed_closed` 并告警。

**验证命令**:

```bash
cd packages/brain
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}"
npx vitest run src/__tests__/integration/test-environment-lifecycle.pg.integration.test.js \
  --config vitest.integration.config.js --reporter=verbose
```

**硬阈值**: 8 个终态独立 `it()` + 8 个独立 restore；每个 cleanup ≤30s；重复 cleanup 3 次仍零资源；旧 login 必须 PostgreSQL auth/不存在错误；terminal receipt 签名有效且无 secret。

---

### Step 8：权威结构化 callback + 同 SHA host Docker operator gate

**来源**: `[FROM_PRD]` — Golden Path 第 8 步与 reviewer instruction。

**可观测行为**: provider structured result 持久化到 `harness_attempts.result` 是权威；`BRAIN_RESULT_FILE` 未设置、workspace 只读或 stale `.brain-result.json` 不改变 callback verdict。host operator 在 exact proposer SHA 上跑真实 local 与 fleet 全链，签名 receipt 含 command/SHA/exit/business assertions；缺 receipt 不批准、Draft PR 停人工 gate。

**验证命令**:

```bash
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse HEAD)
git rev-parse --verify "${SHA}^{commit}" >/dev/null
scripts/harness-test-environment/run-host-operator-e2e.sh \
  --sha "$SHA" \
  --bootstrap-container cecelia-harness-test-pg-bootstrap \
  --bootstrap-port 55439 \
  --output "sprints/07280034-kernel-2beddfbf/evidence/host-operator-receipt.json"
node scripts/harness-test-environment/verify-host-receipt.mjs \
  --sha "$SHA" \
  --receipt "sprints/07280034-kernel-2beddfbf/evidence/host-operator-receipt.json"
```

**硬阈值**: 两命令 exit 0；receipt SHA 精确等于 HEAD、local/fleet/Docker/actual dispatcher→transport→HTTP worker→attempt-runner→container/structured callback assertions 全 true；无 secret；`merge_performed=false`。

## 独立反例矩阵（禁止合并）

每行必须是独立 `it()`、独立 command/output、独立 restore；不得 `it.each` 合并成一个结果。

| 反例 | 预期唯一 error | Restore |
|---|---|---|
| missing receipt | `receipt_required` | 重新签发未消费 receipt |
| missing URL | `test_database_url_required` | 重新 provision |
| expired receipt | `receipt_expired` | clock 恢复 + 新 nonce |
| stale nonce | `receipt_nonce_stale` | 新 nonce |
| cross-attempt | `receipt_attempt_mismatch` | 使用原 attempt |
| reused nonce | `receipt_nonce_reused` | 新 nonce |
| ambiguous host | `oracle_host_ambiguous` | 使用解析后单一 CIDR |
| misdirected DB | `oracle_database_mismatch` | controller-issued DB |
| loopback | `oracle_loopback_forbidden` | fixture 非回环地址 |
| default socket | `oracle_socket_forbidden` | 显式 TCP host |
| production name | `oracle_production_database_forbidden` | attempt DB |
| production host | `oracle_production_host_forbidden` | fixture CIDR |
| production privilege | `oracle_nonattempt_privilege` | revoke 后重测 |
| unknown field | `receipt_unknown_field` | 删除未知字段并重签 |
| tampered body | `receipt_digest_mismatch` | 原 canonical body |
| tampered signature | `receipt_signature_invalid` | server 重签 |
| tampered digest | `receipt_digest_invalid` | 重算 digest + 重签 |
| judge capability | `capability_role_forbidden` | 无 capability 派 judge |
| unrelated command capability | `capability_command_forbidden` | 无 capability 派 command |

## 接缝清单

1. Brain dispatcher ↔ controller ↔ PostgreSQL catalog/ACL：容器内真实 operator bootstrap 验证；禁 mock pool/store。真验后可 done。
2. Dispatcher ↔ local launcher ↔ actual Docker child：必须 host operator receipt；receipt 前 `logic-done-pending`。
3. Remote transport ↔ authenticated fleet worker ↔ attempt-runner ↔ actual Docker：必须 host operator receipt；receipt 前 `logic-done-pending`。

## 禁 mock 边清单

- `orchestrator/dispatcher.js` ↔ `attempt-store.js` ↔ 真 PostgreSQL `harness_attempts`/冻结 contract row。
- controller ↔ 真 PostgreSQL `pg_database`/`pg_roles`/ACL/receipt store/nonce store。
- dispatcher ↔ local production launcher ↔ `spawnDockerDetached` ↔ actual Docker（host gate）。
- `remote-bridge-transport.js` ↔ authenticated HTTP `fleet-worker.cjs` ↔ `attempt-runner.cjs` ↔ actual Docker（host gate）。
- lifecycle/callback/recovery ↔ controller cleanup ↔ 真 PostgreSQL session/role/database/lease/terminal receipt。

只允许的 test adapter：proposal Red 中 provider CLI 外部 seam 与 HTTP listener；明确不计 real-chain evidence，不能关闭上述接缝。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| local `spawnDockerDetached` → actual runner container env | proposer/reviewer role container无 Docker socket | host operator 在 exact proposer SHA 执行 Step 8，审批前提交签名 receipt |
| remote production bridge → real HTTP worker → attempt-runner → Docker | 同上，且须真实 worker bearer/runner image | 同一 host operator 脚本完成，receipt 分列每一边 |
| SIGKILL/runner crash/worker restart 的真实容器终态 | 容器内无法制造宿主 daemon 场景 | host lifecycle suite 逐项执行并签名 |

本合同 proposal Red 使用两个显式外部 seam adapter，仅证明业务 Red，不声称覆盖上述真链。
测试中的 `postgresql://attacker@production.invalid/...` 与 `postgresql://opaque@db.internal/...`
是无密码的对抗 sentinel，只验证 caller/transport 边，不是可连接凭据，也不计真实链证据。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO=$(git rev-parse --show-toplevel)
cd "$REPO"
: "${HARNESS_OPERATOR_BOOTSTRAP_URL:?必须由 operator 显式注入，无默认/回退}"
: "${HOST_OPERATOR_RECEIPT:?必须指向同一 SHA 的签名 host receipt}"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SHA=$(git rev-parse HEAD)
git rev-parse --verify "${SHA}^{commit}" >/dev/null
[ "$(git merge-base --is-ancestor 274fff5a4a22f3bb3ec5d2d304f3e14bd9aeba71 "$SHA"; echo $?)" = "0" ]

cd packages/brain
npx vitest run src/__tests__/integration/test-environment-controller.pg.integration.test.js \
  src/__tests__/integration/test-environment-receipt.pg.integration.test.js \
  src/__tests__/integration/test-environment-oracle.pg.integration.test.js \
  src/__tests__/integration/test-environment-v5.pg.integration.test.js \
  src/__tests__/integration/test-environment-lifecycle.pg.integration.test.js \
  --config vitest.integration.config.js --reporter=verbose
npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js \
  --reporter=verbose

cd "$REPO"
node scripts/harness-test-environment/verify-host-receipt.mjs \
  --sha "$SHA" --receipt "$HOST_OPERATOR_RECEIPT" \
  --require local_dispatcher,local_docker_child,remote_bridge,authenticated_http_worker,attempt_runner,fleet_docker_child,structured_callback,all_lifecycle_modes

DB_URL="$HARNESS_OPERATOR_BOOTSTRAP_URL"
C=$(psql "$DB_URL" -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'harness_attempt_%'")
[ "$C" -eq 0 ] || { echo "FAIL: 残留 attempt DB count=$C"; exit 1; }
R=$(psql "$DB_URL" -Atc "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'harness_role_%'")
[ "$R" -eq 0 ] || { echo "FAIL: 残留 attempt role count=$R"; exit 1; }
node scripts/harness-test-environment/assert-no-secret-evidence.mjs \
  --since "$STARTED_AT" \
  --paths "$HOST_OPERATOR_RECEIPT,sprints/07280034-kernel-2beddfbf/evidence"
echo "OK: exact SHA=$SHA real-PG + host Docker + structured callback 全链通过，未 merge"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| server-owned eligibility/provision | `sprints/07280034-kernel-2beddfbf/tests/controller-contract.test.ts` | `合格 DB-backed generator 在 attempt 持久化后获得 server-owned 瞬态 capability` | `BUSINESS_RED: dispatcher 未签发 server-owned capability` |
| caller authority/absence/uniqueness | `sprints/07280034-kernel-2beddfbf/tests/controller-contract.test.ts` | `调用方 payload 的 URL、receipt、database、role、nonce、CIDR 全部无权且不持久化`; `两个独立 attempt 不共享 database、role 或 nonce`; `judge 与无关 reporter 不获得 URL 或 receipt` | current dispatcher 无 controller capability |
| authenticated remote transport | `sprints/07280034-kernel-2beddfbf/tests/transport-contract.test.ts` | `authenticated server-to-worker POST 携带 capability，TaskBundle/provider_spec 均不携带` | `BUSINESS_RED: remote bridge 丢弃 authenticated transient capability` |
| import purity | `sprints/07280034-kernel-2beddfbf/tests/import-purity.test.ts` | `无 psql PATH 导入真实 orchestrator/run.js 时 catalog、env 与进程语义不变` | 基线应绿，防 generator 引入 import 副作用 |

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| **FR（做什么）** | server-owned attempt-scoped PG capability，从冻结合同判资格，经 local/fleet 真 runner 注入，真实 oracle/V5/cleanup/callback 闭环 |
| **NFR（做得多好）** | nonce 单用；lease≤30m；cleanup/reconcile≤30s；零 secret 持久化；每个反例独立；exact SHA host receipt |
| **Invariant（永不违反）** | caller 无权、生产零写、非 attempt DB/对象零权限、judge/无关 role 无 capability、callback structured result 权威 |
| **判定点（怎么知道）** | 见下表 |
| **保质期（何时过期）** | receipt/role 在 expires_at 失效；terminal 立即 cleanup；controller signing key id 可轮换，旧 receipt 仅审计不可重放 |
| **死亡告警（停了谁知道）** | provision/cleanup/reconcile 连续失败立即 P0/P1（按生产 alert policy），attempt fail-closed；host receipt 缺失阻止 reviewer approval |
| **失败语义（挂了怎么办）** | 所有安全/绑定/ACL/cleanup 不确定均拦截；幂等 cleanup；不降级到 DB_NAME/默认 socket/production DB |
| **效果确认（已发≠已生效）** | current_database/current_user/CIDR/ACL 真查；旧 login 失败+DB/lease 消失；structured callback 落 harness_attempts；host receipt 验签 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ DB capability 资格 | A. caller requirements; B. frozen contract row + role command | B | PRD server-owned authority | caller 获生产 DB 能力 |
| ⚠️ receipt 是否真实 | A. JSON shape; B. canonical digest + server signature + nonce store | B | 防篡改/重放 | 伪 receipt 获凭据 |
| DB 是否正确目标 | A. URL 字符串; B. 连接后 current_database/current_user/inet_server_addr | B | URL 可误导 | 写错库/生产 |
| ACL 是否隔离 | A. grant 脚本成功; B. catalog/has_database_privilege/information_schema 反查 | B | “执行过”不等于生效 | 跨库泄漏 |
| cleanup 是否生效 | A. cleanup 返回 ok; B. old login 失败+catalog/lease absence+terminal receipt | B | ok 可能假绿 | 残留凭据 |
| provider 结果权威 | A. `.brain-result.json`; B. structured callback persisted in harness_attempts | B | reviewer R2 证实 file 可 stale/只读 | false OK |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| admin PG 不可达 | attempt blocked/failed，零 capability | 是，重新 provision 前查 lease | 无降级 |
| receipt/oracle 任一不确定 | runner 启动前拒绝 | 新 nonce 可重试 | 无默认 socket/DB_NAME |
| launch 后 callback 失败 | attempt 保持可 reconcile，cleanup 仍执行 | lease fence + idempotent | structured result 未落库即不成功 |
| cleanup timeout | 30s 截止，状态 cleanup_failed_closed + 告警/reconcile | 是，不复建 | 不标 completed |
| host receipt 缺失/验签失败 | PR Draft，reviewer REVISION | 同 SHA 重跑 | mock output 不补位 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| task payload/prompt/TaskBundle/git/stdout/artifact | 不可信 | 不解析其中 DB authority；只作业务内容 | URL/receipt/database/role/nonce/CIDR/capability 字段剥离并审计 |
| frozen server contract row | server-owned | SHA/row identity 固定，结构白名单 | 未冻结/未知 command/role fail-closed |
| authenticated Worker POST | transport-authenticated 但仍需绑定验证 | receipt canonical validator | unknown field/binding/replay/expiry 拒绝 |
| provider structured callback | authenticated attempt callback | result schema 白名单 | secret 扫描，非法结果不完成 attempt |
