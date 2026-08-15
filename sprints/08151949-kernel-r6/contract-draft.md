# Sprint Contract Draft (Round 1)

## 合同基线与证据来源

- authoritative implementation baseline: `perfectuser21/cecelia@329f2bf0a68759fae45de61d805800e278a2d587`；后续角色不得用本角色 checkout SHA 替换。
- PRD 正文: `inputs.thin_prd`、`inputs.prep_prd_body`，并以 `sprint-prd.md` 补充边界。
- Registry: api/db/test registry 于 2026-08-15 查询成功；freshness=`fresh`，source_revision=`329f2bf0a68759fae45de61d805800e278a2d587`。测试风格采用仓库现有 Vitest `describe/it/expect`。
- `[MAP_NOT_CONFIGURED]`: task payload 有 `map_scope=["F1"]`，但无 `map_repo`，因此不猜测 Unified Map 影响半径，`must_run_assertions=[]`。
- gp-anchor: skipped (product-map.json not found)
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)

## Response Schema（推导来源: PRD字面）

### Endpoint: GET /api/brain/version

**Success (HTTP 200)**:

```json
{"version":"<semver string>","schema_version":"<numeric string or number>"}
```

- `version`（string，必填）：PRD 明确，最终 PASS 必须逐字报告该运行时值。
- `schema_version`（string 或 number，必填）：PRD 明确，转为数字后必须 `>= 430`。
- schema 完整性：本 sprint 只依赖上述两个字段，不改变端点实现或扩展响应。
- 禁用字段名：`brain_version`、`schema`（不得替代 PRD 字段）。

**Error**: N/A — 本 sprint 不改端点错误响应；`curl -f` 获取失败即 smoke 非零退出。

## 已知约束

- `[回归测试] packages/brain/scripts/__tests__/map-engine-smoke.test.mjs`：shell smoke 的永久守卫采用 Vitest `describe/it/expect` 并读取/执行真实脚本。
- `[CI] .github/workflows/ci.yml real-env-smoke`：真实 Brain + 已迁移 PostgreSQL 下执行全部 `packages/brain/scripts/smoke/*.sh`。
- `[累积FR] context-manifest: unavailable（journey_id=none，端点返回 404）`。
- `[铁律]` 冒烟 PASS 必须反映运行时真实状态，禁止硬编码版本制造假成功。
- `[铁律]` schema `<430` 或 authority-table 缺失必须非零退出且不得打印 PASS。
- `[铁律]` Evaluator/Judge 时钟属于既有 Kernel 编排，不在本 sprint 代码范围；N/A，但全链验收不得绕过。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| FR（做什么） | smoke 成功时把 `GET /api/brain/version` 的 `version` 原值写入最终 PASS；永久回归守卫任意硬编码版本。 |
| NFR（做得多好） | 保持现有 curl 行为、版本地板 `1.273.46`、schema 地板 `430` 与四项 authority 检查不变；失败均非零退出。 |
| Invariant（永不违反） | PASS 中版本必须来自本轮 API 响应；schema/authority 未通过时绝不出现 PASS。 |
| 判定点（怎么知道） | 精确比较 API `.version` 与最终 stdout 的 `Brain <version>`；退出码与 PASS 缺席共同判失败。 |
| 保质期（何时过期） | 运行时值每次执行重新获取，不缓存；永久测试随 smoke 同步维护。 |
| 死亡告警（停了谁知道） | CI `real-env-smoke` 当轮非零并标注失败脚本；运维直接执行同样得到非零。 |
| 失败语义（挂了怎么办） | API、schema 或 authority 任一失败即拦截，无降级 PASS。 |
| 效果确认（已发≠已生效） | stdout 必须精确含 API 返回版本，且真实库 authority 查询成功。 |

### 判定点登记表

（本任务无 RPA/第三方真实状态推断接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| version API 不可达/JSON 非法/版本低于地板 | 非零退出，不查 authority，不打印 PASS | 是，纯读取 | 无 |
| schema `<430` | 非零退出，不打印 PASS | 是，纯读取 | 无 |
| authority 查询报错或任一项缺失 | `psql`/`grep` 非零，不打印 PASS | 是，纯读取 | 无 |

### 输入对抗面

N/A — 不新增对外 agent 或可写接口；仅消费本机受信 Brain JSON 与 DB schema 元数据。

## 真实调用方请求 shape

生产调用方就是本 smoke：`curl -fsS "$BRAIN_URL/api/brain/version"`，无认证 header、无 body、`GET` 请求；响应关键字段逐字为 `version` 与 `schema_version`。合同与 DoD 沿用该 shape，不新增别名路径。

## 未覆盖真实链路清单

- 单测中的可执行 `curl`/`psql` fixture｜用于确定性注入两个不同运行时版本及 schema/authority 故障，不替代真实 E2E｜Evaluator 在 `local_api` 以真实 Brain 和迁移后的 attempt PostgreSQL 执行完整 smoke 补位。

## 禁 mock 边清单

- `GET /api/brain/version` 响应 `version` → smoke 最终 PASS stdout（本单修改的边；Final E2E 必须真请求运行中的 Brain，禁止 mock）。
- smoke → PostgreSQL authority schema 查询（虽逻辑不改，但 fail-closed 回归必须由真实迁移后 PostgreSQL 保持验绿）。

## 接缝清单

- Brain HTTP 接缝：真实 `GET /api/brain/version` 的 `.version` 必须与 smoke stdout 精确相同；Evaluator 执行两次，结果不一致判 FLAKY。
- PostgreSQL schema 接缝：真实 migration 后四项 authority 必须存在；`psql` 失败或返回 FAIL 均不得出现 PASS。

## Golden Path

覆盖父路 `harness-control-plane-complete-repair` 第 1-3 步。

[运行 smoke] → [读取并 fail-closed 校验 version/schema] → [fail-closed 校验 authority] → [报告真实运行时版本]

### Step 1: 运维或 CI 执行 control-plane repair smoke

**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 1。

**可观测行为**: 脚本向配置的 Brain 与 PostgreSQL 发起真实只读检查；缺少 `DATABASE_URL` 时非零退出。

**验证命令**: `DATABASE_URL="$DB_URL" BRAIN_URL=http://127.0.0.1:5221 bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh`

**硬阈值**: 命令 exit `0` 才能进入 PASS；任一依赖失败必须非零。

### Step 2: 校验 API version/schema 与 authority tables

**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 2 与「边界情况」。

**可观测行为**: `.version >= 1.273.46`、数值化 `.schema_version >= 430` 且四项 authority schema 全部存在时继续；否则 fail-closed。

**验证命令**: `curl -fsS http://127.0.0.1:5221/api/brain/version | jq -e '(.version|type)=="string" and ((.schema_version|tonumber)>=430) and (keys|index("version")!=null) and (keys|index("schema_version")!=null) and (has("brain_version")|not) and (has("schema")|not)'`

**硬阈值**: HTTP 200；字段 `version` 为 string；schema 数值 `>=430`；PRD 字段存在且禁用别名不存在。

### Step 3: 最终 PASS 精确报告运行时 API version

**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 3 与核心 Acceptance。

**可观测行为**: 最终唯一 PASS 行为 `PASS: Brain ${RUNTIME_VERSION} schema 430 control-plane authorities are deployed`，其中变量来自本次 `VERSION_JSON.version`，不得出现固定 SemVer 字面。

**验证命令**: `RUNTIME_VERSION=$(curl -fsS http://127.0.0.1:5221/api/brain/version | jq -er '.version'); OUT=$(DATABASE_URL="$DB_URL" BRAIN_URL=http://127.0.0.1:5221 bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh); printf '%s\n' "$OUT" | grep -Fx "PASS: Brain $RUNTIME_VERSION schema 430 control-plane authorities are deployed"`

**硬阈值**: stdout 精确命中 API 返回版本；两次不同 fixture 版本均命中自身值；固定版本实现必须使永久测试转红。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current evaluator attempt identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current evaluator capability snapshot}"
export DATABASE_URL="$DB_URL"
export DB_URL
export CECELIA_TICK_ENABLED=false
export BRAIN_PORT="${BRAIN_PORT:-55221}"
BASE_URL="http://127.0.0.1:${BRAIN_PORT}"
EVIDENCE_DIR="${SPRINT_DIR:-sprints/08151949-kernel-r6}/evidence"
mkdir -p "$EVIDENCE_DIR"
APP_PID=""
cleanup() { [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true; }
trap cleanup EXIT
node packages/brain/src/migrate.js
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT (to_regclass('public.harness_attempt_cleanup_outbox') IS NOT NULL AND to_regclass('public.planner_recovery_receipts') IS NOT NULL AND to_regclass('public.planner_recovery_consumptions') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='initiative_runs' AND column_name='planner_recovery_receipt_id'))::text" | grep -qx true
node packages/brain/src/server.js >"$EVIDENCE_DIR/brain.log" 2>&1 & APP_PID=$!
for i in $(seq 1 60); do curl -fsS "$BASE_URL/api/brain/version" >"$EVIDENCE_DIR/version.json" && break; [ "$i" -eq 60 ] && { tail -80 "$EVIDENCE_DIR/brain.log"; exit 1; }; sleep 1; done
RUNTIME_VERSION=$(jq -er '.version | select(type=="string" and length>0)' "$EVIDENCE_DIR/version.json")
jq -e '((.schema_version|tonumber)>=430) and (keys|index("version")!=null) and (keys|index("schema_version")!=null)' "$EVIDENCE_DIR/version.json"
OUT=$(BRAIN_URL="$BASE_URL" DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh)
printf '%s\n' "$OUT" | tee "$EVIDENCE_DIR/smoke-output.txt"
printf '%s\n' "$OUT" | grep -Fx "PASS: Brain $RUNTIME_VERSION schema 430 control-plane authorities are deployed"
npx vitest run sprints/08151949-kernel-r6/tests/runtime-version-reporting.test.ts --reporter=verbose
printf '{"attempt_id":"%s","provider":"%s","account":"%s","machine":"%s","model":"%s","runner_digest":"%s","capability_snapshot_id":"%s","runtime_version":"%s"}\n' "$HARNESS_ATTEMPT_ID" "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}" "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "$CAPABILITY_SNAPSHOT_ID" "$RUNTIME_VERSION" > "$EVIDENCE_DIR/provenance.json"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: version JSON 缺字段、空字符串、非数字 schema、畸形 SemVer。
- 重复提交: 连续执行 smoke 两次，确认每次重新读取 API 且 PASS 无缓存版本。
- 中途中断: Brain 在 version 请求后停止或 DB 断连，确认无 PASS。
- 边界值: schema `429/430`，version 等于地板与高于地板。
- 人形留证: 把命令 stdout/stderr、退出码与 `exploration_notes` 保存到 sprint evidence，并截取真实终端的成功/失败观察为 `${SPRINT_DIR}/screenshots/runtime-pass.png` 与 `${SPRINT_DIR}/screenshots/fail-closed.png`；截图不得代替命令 oracle。
- 发现分级: P0/P1（假 PASS、fail-open）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 真实版本报告 | `tests/runtime-version-reporting.test.ts` | `PASS reports the exact runtime API version instead of a hard-coded version` | 当前硬编码输出不含 fixture API 版本，1 个 test FAIL |
| fail-closed 保留 | `tests/runtime-version-reporting.test.ts` | `schema below 430 remains fail-closed`、`authority-table failure remains fail-closed` | 保护逻辑被删时对应 test FAIL |

## Notes

- 本任务 `journey_type=autonomous`，不适用 staging 预览闸。
- Generator 必须先提交本合同 Red 测试，再改 smoke；永久测试落位 `packages/brain/scripts/__tests__/harness-control-plane-complete-repair-smoke.test.mjs` 并保持相同测试名子串。
- Validator identity 全部 late-bound；Evaluator 保存自身 provenance，Judge 以不同 provider/account/session 引用 Evaluator evidence SHA-256，不复用本 Proposer identity。
