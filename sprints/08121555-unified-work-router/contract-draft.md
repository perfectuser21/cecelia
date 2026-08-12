# Sprint Contract Draft (Round 3)

## Round 2 blocker closure

- R2-1：冻结 RED 测试改为创建真实临时 Git source/clone，直接调用 `ensureHarnessWorktree()`，断言带凭据 origin 与干净 origin 同仓、活跃 cwd 没有进入删除回调、日志不含 secret；B-00 与 Final E2E 均执行该 Sprint 测试。quote: `在真实临时 Git repo 建立带 credential 的同仓 origin，并把 detached cwd 标为活跃 run 后调用 worktree ensure/cleanup`。这使三个 Recovery 行为任何一个未实现都会保持 RED，且永久进入 DoD。
- R2-2：scratch smoke 必须写出本轮 API/Intent/Capture 三个 task id，治理 SQL 以 `task_ids_csv` 精确绑定这三项，分别要求 3 个 receipt、3 个 active Impact Contract 和每个 repo 的四类 Map header。quote: `治理 SQL 从 smoke-targets.json 读取本轮 API/Intent/Capture 三个 task id，逐项验证 receipt、Map 与 active Impact Contract`。不再以“最近一项 Harness task”代替验收对象。

## 证据来源与基线

- 实现基线（唯一权威）：`310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`；角色 checkout `f26dfd6...` 仅供起草，不替换实现基线。
- Universal Map：scope `cecelia`，2026-08-12 查询为 `fresh`；fact revision `3958eeb5757f5aad5cb65db982f16609d3d45716`，api/db_schema/graph/test 四 scanner 均 fresh。
- radius：任务未提供 `expected_files`，故 `must_run_assertions=[]`；不得回退到硬编码断言。
- Registry：api/db_schema/test 均有记录；本任务为内部路由与持久化合同，不新增单一 HTTP response schema。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务跨内部路由、DB、hook 与 Kernel 执行链，不定义一个新的单一 HTTP 响应。实现必须逐字保留 PRD 的 `NormalizedWorkRequest`、`RouteDecision`、`Routing Receipt` 字段与四种 `change_kind`，未知枚举 fail closed。

## 已知约束（来自回归测试）

- `packages/brain/src/__tests__/harness-worktree.test.js` → 既有 worktree 可复用，孤儿目录才重建。
- `packages/brain/src/__tests__/harness-worktree-state-validation.test.js` → `.git` 状态及 origin 校验必须保持。
- `packages/brain/src/__tests__/startup-recovery-active-container-protect.test.js` → 活跃容器挂载的 worktree 不得清理。
- `docker/cecelia-runner/entrypoint-provider-contract.test.sh` → Generator 环境必须移除 callback/lease 凭据并保留 frozen-baseline 闸。
- `[累积FR] context-manifest: unavailable（PRD 未给 journey_id）`。

## 锚定父路声明

独立小路（无父路）

## Golden Path

真实入口 → Work Router 原子创建 task+receipt → fresh Map+Impact Contract → 四形式 Kernel → 有头/无头动作闸 → Generator 隔离 → scratch 真实验收

### Step 0: 恢复 Harness 工作区安全
**来源**: `[FROM_PRD]` — RECOVERY ADDENDUM。

**可观测行为**: credential-bearing origin 与无凭据同仓 URL 归一为同一身份；日志不含凭据；活跃 Kernel cwd 不被删除。

**验证命令**:
```bash
cd packages/brain && npx vitest run ../../sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts src/__tests__/harness-worktree-recovery-contract.test.js
```
**硬阈值**: 冻结 Sprint RED 与永久实现回归均全绿；真实临时 clone 未删除、0 个 credential 泄漏；以上命令 exit 0。

### Step 1: 所有入口获得不可变 Routing Receipt
**来源**: `[FROM_PRD]` — §3、§8、§12 与 Knife 0-2。

**可观测行为**: 33 处机器清单逐项收敛；coding mutation 只创建 `harness_initiative`；task 与 receipt 同事务；四形式只正向映射；三项历史缺陷永久回归。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/__tests__/planner-task-type-regression.test.js src/__tests__/proposal-task-type-regression.test.js src/routes/__tests__/capture-atoms-routing.test.js
```
**硬阈值**: `VALID_TASK_TYPES` 动态计数与 unique 均为 70、inventory 逐项恰为 33，Planner INSERT 含 task_type、Proposal 不把 change.skill 当 task_type、Capture 只写真实 decisions 列；coding 覆盖率 100%、receipt UPDATE/DELETE 均失败；命令 exit 0。

### Step 2: fresh Map 与 Impact Contract 成为 Kernel 启动门禁
**来源**: `[FROM_PRD]` — §10、§10.1 与 Knife 3。

**可观测行为**: 每个新 coding run 的 policy 为 `required`；stale/missing/revision mismatch/scanner invalid 均在 Provider 前失败；合法 map_recovery 仅限 bugfix allowlist。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js
```
**硬阈值**: `legacy_exempt` 新增 0，所有失败原因码稳定；命令 exit 0。

### Step 3: 有头与无头 mutation 在动作前 fail closed
**来源**: `[FROM_PRD]` — §12、§15 与 Knife 4。

**可观测行为**: hook 校验 lock/receipt/run/repo/branch/base SHA；Dispatcher 在 executor 前验证同一 receipt；无 session/lock、Brain 不可达或字段不一致均 exit 2/route_violation。

**验证命令**:
```bash
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js
```
**硬阈值**: mutation 绕过数 0，只读诊断不误伤；命令 exit 0。

### Step 4: Generator frozen baseline 与 trust boundary 生效
**来源**: `[FROM_PRD]` — Knife 3-4、Recovery Contract Correction。

**可观测行为**: Generator 不能 push/callback，hook 在容器内可达；产出 HEAD 是冻结实现基线的后代，而非等于基线。

**验证命令**:
```bash
BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh && git merge-base --is-ancestor "$BASELINE_SHA" HEAD && [ "$(git rev-parse HEAD)" != "$BASELINE_SHA" ]'
```
**硬阈值**: blocked push 非 0、Provider 无 callback token、lineage 命令 exit 0 且 `HEAD != BASELINE_SHA`。

### Step 5: scratch 多入口真实产出
**来源**: `[FROM_PRD]` — §16.6 与 Knife 5。

**可观测行为**: API/Intent/Capture 三个 coding 请求均有 receipt、Harness run、正确 repo Map、active Impact Contract；smoke 输出精确 task id 清单；content/research/review 对照不误路由；stale 后阻塞、刷新后恢复且审计保留。

**验证命令**:
```bash
DB_URL="$DB_URL" BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 SMOKE_TARGETS_FILE=sprints/08121555-unified-work-router/smoke-targets.json bash packages/brain/scripts/smoke/unified-work-router-smoke.sh && TASK_IDS=$(jq -er '[.api.task_id,.intent.task_id,.capture.task_id] | if length==3 and all(. != null) then join(",") else error("three task ids required") end' sprints/08121555-unified-work-router/smoke-targets.json) && psql "$DB_URL" -v ON_ERROR_STOP=1 -v baseline=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 -v task_ids_csv="$TASK_IDS" -f sprints/08121555-unified-work-router/tests/baseline-governance.sql
```
**硬阈值**: 精确 task id 3/3、receipt 3/3、Impact Contract 3/3、每个目标 repo 的 api/db_schema/graph/test Map 4/4 且三类基线字段逐字等于实现基线；错误路由 0、`legacy_exempt` 新增 0；命令 exit 0。

## 实现血统与 TDD 提交合同

- `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524` 始终是实现基线；最终只验 `git merge-base --is-ancestor "$BASELINE_SHA" HEAD`。
- Recovery RED/GREEN 先于 Knife 0；Knife 0-5 每项必须先提交失败测试再提交实现，RED/GREEN commits 永久保留。
- Routing Receipt、Universal Map、Impact Contract 的 base_sha/source_revision 必须等于实现基线；禁止把角色 checkout SHA 或未来角色 attempt/snapshot 固化。

## 真实调用方请求 shape

- 有头 hook：认证由受认证 Brain API transport 提供；请求关键字段逐字为 `task_id,routing_receipt_id,run_id,repo,branch,base_sha`，来源为 `.dev-lock.<branch>`，不得改放自由文本。
- 无头 Dispatcher：从 task 的 `routing_receipt_id` 投影读取专用表事实；不得相信 payload 自称 pipeline/change_kind。
- 实际执行身份 late-bound：只读 Runner 注入的 `HARNESS_ATTEMPT_ID/HARNESS_PROVIDER/HARNESS_ACCOUNT/HARNESS_MACHINE/HARNESS_MODEL/HARNESS_RUNNER_DIGEST/CAPABILITY_SNAPSHOT_ID`；本轮 authoring UUID 不进入验收期望。

## 禁 mock 边清单

- `createRoutedTask` ↔ PostgreSQL `tasks/work_routing_receipts`：真 Postgres 验原子性、幂等与 append-only。
- Work Router ↔ 全部创建入口：入口合同真调用相邻 router/store，不 mock 被改边。
- Kernel preflight ↔ Universal Map/Impact Contract store：集成测试用真实临时 repo 与真测试 DB。
- Engine hook ↔ Brain receipt validation API ↔ Git worktree：真实临时 worktree；只允许外层网络 transport fixture。
- Generator entrypoint ↔ git remote/setpriv/env/hook：真实容器命令链，不以源码 grep 代替。

## 接缝清单

1. PostgreSQL 原子落库与 scratch 迁移：attempt 隔离 DB 真验，未真验为 `logic-done-pending`。
2. 临时 Git worktree/origin/cwd 生命周期：真实 repo 重复 2 次，日志留证，未真验为 `logic-done-pending`。
3. Docker Generator 权限边界：真实容器重复 2 次，未真验为 `logic-done-pending`。

## 未覆盖真实链路清单

（本合同禁止 mock 被改边；外层网络 transport fixture 不替代任何 Golden Path，N/A）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 唯一 Work Router、不可变 receipt、Map/Impact Gate、动作闸、Generator 隔离、scratch 验收 |
| NFR | coding 覆盖率 100%，未路由/legacy_exempt 新增均 0；确定性且事务幂等 |
| Invariant | 所有 coding mutation 先获 receipt；四形式不反推；实现基线不可替换；失败关闭 |
| 判定点 | 见下表 |
| 保质期 | receipt append-only；validation result 短时且过期失败；Map 查询时判 freshness |
| 死亡告警 | route_violation/map_preflight_failed 立即记录，Dashboard 与生产指标可见 |
| 失败语义 | repo/Map/receipt/身份不成立即阻塞，不降级、不 legacy_exempt |
| 效果确认 | DB receipt、active contract、Git lineage、真实容器与 scratch 产出交叉确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ origin 是否同仓 | 原字符串相等；规范化后 repo identity | 规范化并去 credential 后比较 | credential URL 与公开 URL 指向同仓 | 活跃 cwd 被删且 Kernel fatal |
| mutation-capable tool | 工具名 allowlist；版本化命令合同 | Edit/Write 固定写，Bash 解析，未知按写 | fail-closed 且允许只读恢复 | 未路由代码被修改 |
| Map 是否可用 | 时间戳；四 scanner+revision | freshness、scanner version、baseline revision 全验 | PRD §10 | 错事实进入实现 |

notes: judgment-pending-user: 无（以上判定方法已在批准 PRD 明确）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo/receipt 不成立 | 阻塞并写 reason_code | 是，source+source_id+router_version | 无 |
| Map stale/missing | Provider 前失败 | 刷新后 resume | 仅窄化 map_recovery |
| hook API 不可达 | exit 2 | 是 | 只读诊断仍可用 |
| Generator 越权 | 立即失败并留证 | 否 | trusted transport 仅 Judge 后发布 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| API/对话/Inbox/自动任务 | 不受信任到来源合同受限 | 只收敛为严格枚举，保存 evidence | unknown coding 按 write；未知枚举拒绝 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 15 分钟 / 15 动作（路由与权限边界高风险）
高风险面:
- 错输入: 未知 `change_kind`、歧义 repo、伪造 receipt id。
- 重复提交: 同一 source/source_id/router_version 并发创建两次。
- 中途中断: task 已插入但 receipt 写入前 DB 故障；Map 刷新中 resume。
- 边界值: credential URL 含特殊字符；detached HEAD；superseded/expired receipt。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner identity required}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner capability snapshot required}"
BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524
git merge-base --is-ancestor "$BASELINE_SHA" HEAD
[ "$(git rev-parse HEAD)" != "$BASELINE_SHA" ]
export DATABASE_URL="$DB_URL"
node packages/brain/src/migrate.js
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('tasks') IS NOT NULL AND to_regclass('fact_snapshot_headers') IS NOT NULL AND to_regclass('harness_impact_contracts') IS NOT NULL AND to_regclass('work_routing_receipts') IS NOT NULL" | grep -qx t
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
cd packages/brain
npx vitest run src/__tests__/harness-worktree-recovery-contract.test.js src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/__tests__/planner-task-type-regression.test.js src/__tests__/proposal-task-type-regression.test.js src/routes/__tests__/capture-atoms-routing.test.js src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js src/orchestrator/__tests__/dispatcher-routing-receipt.test.js
cd ../..
npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh
bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh
SMOKE_TARGETS_FILE=sprints/08121555-unified-work-router/smoke-targets.json DB_URL="$DB_URL" BASELINE_SHA="$BASELINE_SHA" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
TASK_IDS=$(jq -er '[.api.task_id,.intent.task_id,.capture.task_id] | if length==3 and all(. != null) then join(",") else error("three task ids required") end' sprints/08121555-unified-work-router/smoke-targets.json)
psql "$DB_URL" -v ON_ERROR_STOP=1 -v baseline="$BASELINE_SHA" -v task_ids_csv="$TASK_IDS" -f sprints/08121555-unified-work-router/tests/baseline-governance.sql
git diff --check "$BASELINE_SHA"..HEAD
```

通过标准：全部命令 exit 0；DB/容器/Git 真实产出证据齐全。E2E 使用当前 Runner late-bound 身份，Evaluator 证据引用 Generator receipt，Judge 再引用 Evaluator 证据 SHA-256。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Recovery 前置 | `tests/unified-work-router-contract.test.ts` | credential-bearing origin 不泄漏且不删除活跃 cwd | 当前 origin 原字符串比较/日志输出导致失败 |
| 路由与治理绑定 | `tests/unified-work-router-contract.test.ts` | 三入口治理记录逐项锚定 baseline | 旧 SQL 只选最近一项任务且不绑定三入口 |

## staging 预览闸

N/A — `journey_type=dev_pipeline`，非 user_facing。
