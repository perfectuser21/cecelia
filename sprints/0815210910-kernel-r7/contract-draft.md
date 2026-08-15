# Sprint Contract Draft (Round 1)

## 实现基线与范围

- 权威实现基线：`perfectuser21/cecelia@aed36ad41bd3d86ff7dc2761bd478df6b3e6f2a0`；本轮及后续角色不得用角色 checkout 的 `workspace_spec.base_sha` 替换它。
- 实现只允许修改 `packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh`，并新增 `packages/brain/scripts/__tests__/harness-control-plane-repair-version-report.test.mjs`。
- 不修改版本下限 `1.273.46`、schema 下限 `430`、权威表 SQL、其他 smoke 或 `packages/brain/src/`。
- `[MAP_NOT_CONFIGURED]`：task payload 有 `map_scope=["F1"]`，但无 `map_repo`，因此不猜测 Unified Map；`affected_business_nodes=[]`、`must_run_assertions=[]`。
- registry 证据：API/DB/test registry 均为 fresh，`source_revision=aed36ad41bd3d86ff7dc2761bd478df6b3e6f2a0`；API 路由源码确认 `GET /api/brain/version` 返回现有字段。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面 + api_registry对应源码）

### Endpoint: GET /api/brain/version

**Success (HTTP 200)**:

```json
{"schema_version":"430","version":"1.273.54"}
```

- `version`（string，必填）：PRD 明确，运行时实际版本，须匹配 `x.y.z`。
- `schema_version`（string，必填）：PRD 明确；现有 `EXPECTED_SCHEMA_VERSION` 契约为字符串。
- 顶层 keys 必须完全等于 `["schema_version","version"]`。
- 禁用字段名：`[]`（PRD 未定义同义替换或禁用字段）。

**Error (HTTP 500)**:

```json
{"error":"version read failed"}
```

该 sprint 不修改端点 schema；它只消费成功响应。错误响应保留为已知约束，不扩充实现范围。

## 已知约束（来自回归测试、铁律与上下文）

- `[packages/brain/scripts/__tests__/map-engine-smoke.test.mjs]` → 同目录脚本回归测试使用 Vitest 的 `describe/it/expect` 与 `readFile`。
- `[packages/brain/src/__tests__/selfcheck.test.js]` → `EXPECTED_SCHEMA_VERSION should be 430`，schema 下限不得回退。
- `[累积FR]` journey_id 为空；无累积 FR。
- `context-manifest: unavailable (journey_id=none)`。
- Brain URL 权威：真实验收仅从 `${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version` 读取版本。
- 评估时钟采纳：不创建或替换既有 validation clock；Evaluator/Judge 使用各自 Runner 注入身份与证据时钟。
- 验证命令实跑：定向 Vitest 必须看到测试收集与真实退出码；不接受 include 外路径的空绿。
- 证据一手：保留 curl 响应、smoke stdout、Vitest 输出摘要。
- 口径先查：版本差异以同一次 E2E 的 API 响应与 PASS 行比较，不用历史日志。

## Golden Path

覆盖父路 `harness-control-plane-complete-repair-smoke` 第 1-4 步。

[运维/CI 执行 smoke] → [读取运行时版本并校验] → [校验 schema 与权威表] → [输出包含确切运行时版本的 PASS]

### Step 1: 从真实 Brain 读取运行时版本响应

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: `GET /api/brain/version` 返回且仅返回字符串字段 `version`、`schema_version`；`version` 为三段 semver。

**验证命令**:

```bash
RESP=$(curl -fsS "${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version"); printf '%s' "$RESP" | jq -e 'keys == ["schema_version","version"] and (.version | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and (.schema_version | type == "string")'
```

**硬阈值**: HTTP 200；keys 精确相等；`version` 为 string semver；`schema_version` 为 string。上方命令任一断言失败即非零退出。

### Step 2: 版本与 schema 下限继续 fail-closed

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及「边界情况」。

**可观测行为**: 版本低于 `1.273.46` 或 `schema_version < 430` 时，真实 smoke 非零退出且 stdout 不出现最终 PASS。

**验证命令**:

```bash
cd packages/brain && npx vitest run scripts/__tests__/harness-control-plane-repair-version-report.test.mjs -t 'schema_version 低于 430 时 fail-closed 且不输出 PASS' --reporter=verbose
```

**硬阈值**: 定向测试收集 1 条并 exit 0；被测 smoke 的低 schema 子进程 exit 非 0，输出不含 `PASS: Brain`。

### Step 3: 权威表闸继续 fail-closed

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步。

**可观测行为**: 任一要求的表或列缺失时，真实 smoke 非零退出且不输出最终 PASS；原 SQL 检查对象不变。

**验证命令**:

```bash
cd packages/brain && npx vitest run scripts/__tests__/harness-control-plane-repair-version-report.test.mjs -t '权威表检查失败时 fail-closed 且不输出 PASS' --reporter=verbose
```

**硬阈值**: 定向测试收集 1 条并 exit 0；被测 smoke 的失败子进程 exit 非 0，输出不含 `PASS: Brain`。

### Step 4: 最终 PASS 回显本次 API 的确切版本

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步与出口。

**可观测行为**: 全部前置闸通过后，最终一行严格等于 `PASS: Brain <本次 API version> schema 430 control-plane authorities are deployed`；源码 PASS 模板中没有三段版本字面量。

**验证命令**:

```bash
RUNTIME_VERSION=$(curl -fsS "${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version" | jq -er '.version'); OUT=$(BRAIN_URL="${BRAIN_URL:-http://127.0.0.1:5221}" DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh); [ "$(printf '%s\n' "$OUT" | tail -n 1)" = "PASS: Brain ${RUNTIME_VERSION} schema 430 control-plane authorities are deployed" ]
```

**硬阈值**: smoke exit 0；最终一行逐字等于由同轮 API 响应构造的期望值，比较失败即非零退出。

## 禁 mock 边清单

- `VERSION_JSON` → 运行时版本提取 → 最终 PASS 格式化（本单修改的脚本内部数据传递边，测试必须真实执行 shell 脚本，不得 stub 这段逻辑）。
- smoke → `GET /api/brain/version` 与 smoke → PostgreSQL 权威表检查（Final E2E 必须真 curl、真迁移后 PostgreSQL；单元回归可用进程级 fixture 控制外部成功/失败输入，但不得替换被改脚本）。

## 接缝清单

- Brain HTTP 接缝 `[接缝×2]`：同一 E2E 连续两次读取真实 `/api/brain/version`，两次均须符合 schema；最终 PASS 必须匹配执行 smoke 前紧邻读取的版本。真目标验证通过才可标 done。
- PostgreSQL 权威表接缝 `[接缝×2]`：对 attempt 级 `DB_URL` 运行仓库真实 migration 后连续两次执行 smoke，两次均须通过全部表/列闸；任一次不一致判 FLAKY。

## 真实调用方请求 shape

N/A — 本 sprint 不新增设备/agent/webhook 请求；现有调用方是运维 shell：`GET ${BRAIN_URL}/api/brain/version`，无认证 body、无 query、无 payload，smoke 使用 `curl -fsS`。数据库认证仅来自 Fleet 注入的 attempt 级 `DB_URL`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；Final E2E 真调 Brain 与 PostgreSQL。单元测试的进程 fixture 只用于确定性构造失败输入，不替代 Final E2E。）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 最终 PASS 回显本次 `/api/brain/version` 的 `version`，并永久拒绝硬编码 PASS 版本。 |
| **NFR（做得多好）** | 性能/可靠性 | 不新增网络请求；复用已获取的 `VERSION_JSON`；所有旧闸 fail-closed。 |
| **Invariant（永不违反）** | 安全/一致性 | 最低版本 `1.273.46`、schema ≥430、三表一列权威检查保持不变。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 退役条件 | 动态读取无版本保质期；仅端点 schema 变更时需同步回归合同。 |
| **死亡告警（停了谁知道）** | 告警 | CI/运维 smoke 非零退出，当次日志直接暴露，无静默成功。 |
| **失败语义（挂了怎么办）** | 故障策略 | curl、JSON、版本/schema、DB 或权威对象任一失败均阻断 PASS，禁止降级。 |
| **效果确认（已发≠已生效）** | 回执 | 同轮 API `version` 与 smoke 最终行逐字比较，并保存 stdout。 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝模糊判定点，N/A；全部使用精确字符串、数值下限和数据库对象存在性判断。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| version API 不可达/响应非法 | smoke 非零退出，不输出 PASS | 是，只读重试 | 无降级 |
| version 或 schema 低于下限 | smoke 非零退出，不输出 PASS | 是 | 无降级 |
| DB_URL 缺失或权威对象缺失 | smoke 非零退出，不输出 PASS | 是，只读检查 | 无降级 |

### 输入对抗面

N/A — 不对外暴露 agent 或用户输入接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 令 fixture `/api/brain/version` 返回缺少 `version`、非 semver 或非法 JSON，确认无 PASS。
- 重复提交: 在同一迁移后 DB 上连续执行 smoke 两次，确认两次 PASS 都匹配各自紧邻 API 响应。
- 中途中断: API 可用但 DB_URL 缺失，确认错误前结束且无 PASS。
- 边界值: `version=1.273.46`、高于下限、低于下限各一例；`schema_version=429/430` 各一例。
- 人形留证: 将探索命令、stdout 与发现写入 `exploration_notes`；本任务无 UI，截图 N/A 并注明原因。

发现分级: P0/P1（假 PASS、旧闸被绕过）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation identity}"
: "${HARNESS_PROVIDER:?Runner must inject current provider}"
: "${HARNESS_ACCOUNT:?Runner must inject current account}"
: "${HARNESS_MACHINE:?Runner must inject current machine}"
: "${HARNESS_MODEL:?Runner must inject current model}"
: "${HARNESS_RUNNER_DIGEST:?Runner must inject current runner digest}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
BRAIN_URL="${BRAIN_URL:-http://127.0.0.1:5221}"
export DATABASE_URL="$DB_URL"
LOG_DIR=$(mktemp -d)
cleanup() { rm -rf "$LOG_DIR"; }
trap cleanup EXIT

node packages/brain/src/migrate.js >"$LOG_DIR/migrate.log" 2>&1
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT (to_regclass('public.harness_attempt_cleanup_outbox') IS NOT NULL AND to_regclass('public.planner_recovery_receipts') IS NOT NULL AND to_regclass('public.planner_recovery_consumptions') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='initiative_runs' AND column_name='planner_recovery_receipt_id'))::text" | grep -qx true

VERSION_JSON=$(curl -fsS "$BRAIN_URL/api/brain/version")
printf '%s' "$VERSION_JSON" | jq -e 'keys == ["schema_version","version"] and (.version | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and (.schema_version | tonumber >= 430)' >"$LOG_DIR/version-schema.json"
RUNTIME_VERSION=$(printf '%s' "$VERSION_JSON" | jq -er '.version')

for RUN_NO in 1 2; do
  OUT=$(BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh)
  printf '%s\n' "$OUT" >"$LOG_DIR/smoke-$RUN_NO.log"
  ACTUAL=$(printf '%s\n' "$OUT" | tail -n 1)
  EXPECTED="PASS: Brain ${RUNTIME_VERSION} schema 430 control-plane authorities are deployed"
  [ "$ACTUAL" = "$EXPECTED" ] || { printf 'FAIL expected=%s actual=%s\n' "$EXPECTED" "$ACTUAL"; exit 1; }
done

cd packages/brain
npx vitest run scripts/__tests__/harness-control-plane-repair-version-report.test.mjs --reporter=verbose | tee "$LOG_DIR/regression.log"
cd ../..
grep -q 'Tests.*4 passed' "$LOG_DIR/regression.log"
printf 'PASS runtime_version=%s validation_attempt=%s capability_snapshot=%s\n' "$RUNTIME_VERSION" "$HARNESS_ATTEMPT_ID" "$CAPABILITY_SNAPSHOT_ID"
```

通过标准：migration exit 0；三表一列存在；API schema/下限通过；真实 smoke 连续两次 exit 0 且最终行精确匹配本轮 `RUNTIME_VERSION`；永久回归测试 4/4 通过。任一条件失败即 FAIL。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合同 Red | `sprints/0815210910-kernel-r7/tests/harness-control-plane-repair-version-report.test.ts` | `拒绝最终 PASS 中硬编码版本字面量`；`最终 PASS 上报 API 返回的确切运行时版本` | 基线 2 tests failed |
| 永久回归 | `packages/brain/scripts/__tests__/harness-control-plane-repair-version-report.test.mjs` | `拒绝最终 PASS 中硬编码版本字面量`；`最终 PASS 上报 API 返回的确切运行时版本`；`schema_version 低于 430 时 fail-closed 且不输出 PASS`；`权威表检查失败时 fail-closed 且不输出 PASS` | 实现前至少前两项失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 身份 late-bound：Evaluator 与 Judge 必须分别使用 Runner 注入的 `HARNESS_*`、`CAPABILITY_SNAPSHOT_ID`；Judge 引用 Evaluator 证据 SHA-256，不共享 authoring attempt/account/snapshot。
- 本合同不要求 signup/login：被测端点与 smoke 无业务身份，数据库仅执行仓库 migration 与只读 schema 权威检查。

