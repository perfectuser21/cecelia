# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面）

本 Sprint 同时新增内部路由对象、持久化 receipt 与受鉴权查询/验证端点；HTTP 路径与认证方式以现有 Brain 路由注册方式为准，PRD 未冻结具体 URL，因此不得由合同虚构 endpoint。稳定数据键必须字面使用 PRD 的 `work_kind`、`change_kind`、`pipeline`、`canonical_task_type`、`default_execution_profile`、`execution_profile_override`、`repo`、`map_scope`、`impact_contract_required`、`orchestrator`、`router_version`、`route_reason`、`evidence`、`decided_at`。错误必须包含稳定 `reason_code`。禁止以 payload 内投影代替专用 receipt 事实源。

## Map 与证据来源

- `[MAP_NOT_CONFIGURED]`：task payload 有 `map_scope=cecelia` 但缺 `map_repo`；不得回退到领域硬编码，Generator 必须通过统一路由补齐规范 repo 后再建立 Impact Contract。
- `must_run_assertions`: 当前为空；不额外猜测回归断言。
- `fact_revisions/freshness`: 当前 Map 未配置；运行时必须查询 fresh metadata，禁止固化本轮 Proposer 身份或快照。
- api/db/test registry 可访问；字段以 PRD 字面与 migration 410 现状为基线，测试栈采用 Vitest。
- gp-anchor: skipped (product-map.json not found)

## 已知约束（来自回归测试与累积 FR）

- `[累积FR]` 本 line 暂无已验收历史行为。
- `[回归]` `packages/brain/src/orchestrator/` 现有测试要求 Impact Contract、frozen baseline 与 provider trust boundary 继续成立。
- `[回归]` Engine hook 集成测试必须使用真实临时 Git worktree；不得 mock 被改的动作闸边。
- `[回归]` runner shell 合同测试必须验证容器内实际命令链和环境剥离。
- `context-manifest`: PRD 已注入结果为本 line 暂无历史。

## Golden Path

覆盖父路 factory/F1 第 1-7 步

[任一有头/无头创建入口] → [统一路由与不可变 receipt] → [fresh Map 与 required Impact Contract] → [动作前双闸] → [Generator 隔离执行] → [scratch 多入口真实验收与可信发布]

### Step 0: 恢复工作区清理安全
**来源**: `[FROM_PRD]` — PRD「Golden Path 1」与 Recovery Addendum。

**可观测行为**: 含凭据与不含凭据的同一 Git origin 归一化后相等；日志只含脱敏 origin；绑定 active Kernel run 的 detached cwd 不被 orphan cleanup 删除。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-workspace-recovery.test.js --reporter=verbose
```
**硬阈值**: 三项永久回归全部通过，日志中 token/userinfo 命中数为 0；验证命令 exit 0。

**RED 合同**: `tests/unified-work-router-contract.test.ts` 必须同时创建真实 bare remote、credential-bearing origin 与 detached worktree，并以 active `initiative_runs`/attempt 绑定调用 `ensureHarnessWorktree()` 两次；在修复前至少因 canonicalizer 缺失、凭据日志泄露或 active cwd 被删除之一失败。仅测试 URL 字符串转换不算本步骤 RED。

### Step 1: 统一分类并原子写入 receipt
**来源**: `[FROM_PRD]` — PRD「Knife 0-1」与数据合同。

**可观测行为**: 同输入/同 router version 得到同一决定；coding unknown 按 write；repo 缺失或歧义稳定失败；task 与 append-only receipt 同事务同生同灭。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose
```
**硬阈值**: 四档映射全覆盖；UPDATE/DELETE receipt 均拒绝；事务失败后 task/receipt 行数均为 0；命令 exit 0。

### Step 2: 全部任务创建入口收敛
**来源**: `[FROM_PRD]` — PRD「Golden Path 3」「Knife 2」。

**可观测行为**: 从 `VALID_TASK_TYPES` 动态核对事实；机器清单逐项覆盖当前创建入口；coding 只产出 `harness_initiative`，content/research/read-only 不误路由；Planner、Proposal、Capture 三陷阱永久回归。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose
```
**硬阈值**: 事实源无重复；inventory 每项有入口合同；业务入口裸 INSERT 扫描为 0；命令 exit 0。PRD 所述 70/33 是考古基线，测试须同时报告主线实时计数，不能复制常量伪造。

### Step 3: 四形式与 Map/Impact Contract 强制 preflight
**来源**: `[FROM_PRD]` — PRD「Golden Path 4」「Knife 3」。

**可观测行为**: `change_kind` 只正向选择默认 profile；fresh、同 repo、同 baseline Map 才允许 Provider；Impact Contract 恒为 required；窄化 map recovery 只消费一次且修复后全量重扫 fresh。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose
```
**硬阈值**: missing/stale/revision mismatch/scanner invalid/cross-repo 在 Provider attempt 创建前全部稳定失败；新 coding run 的 `legacy_exempt` 数为 0；命令 exit 0。

**冻结 baseline 机检**: 本 Sprint 的唯一 baseline 是 `a9f612148e227df9fcd1481f9b39d38dd40f791f`；Map `source_revision`、Routing Receipt `base_sha`、workspace spec `base_sha` 与 Impact Contract baseline 必须逐字相等，任一不等在 Provider attempt 创建前返回非零并记录稳定 `reason_code=map_revision_mismatch`。

### Step 4: 有头与无头动作前安全闸
**来源**: `[FROM_PRD]` — PRD「Golden Path 5」「Knife 4」。

**可观测行为**: 有头 mutation tool 在动作前校验 live session、lock、receipt、run、repo、branch、base SHA；无头 Dispatcher 在 executor 前校验同一 receipt；失配记录 `route_violation` 且不修改 payload 自救。

**验证命令**:
```bash
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose
```
**硬阈值**: 每个缺失/过期/superseded/API 不可达/HEAD 不匹配写动作 exit 2；只读诊断 exit 0；Dispatcher 违规 executor 调用次数为 0。

### Step 5: Generator frozen baseline 与 trust boundary
**来源**: `[FROM_PRD]` — PRD「Golden Path 5」与 Generator 权限 Invariant。

**可观测行为**: 所有 Generator attempt 都启用 frozen-baseline pre-push、退出 lineage assertion、blocked pushurl、非特权 UID/capability 清空，并剥离 callback/lease/Brain 凭据；获批 ref 仅由可信 transport 发布。

**验证命令**:
```bash
bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh
```
**硬阈值**: Provider push 非 0；敏感环境变量在 Provider 内均不可见；hook 路径在容器内存在且实际触发；trusted transport 在 Judge 前发布次数为 0。

### Step 6: scratch 多入口真实验收与出口指标
**来源**: `[FROM_PRD]` — PRD「Golden Path 6-7」「Knife 5」。

**可观测行为**: API、Intent、Capture 三入口 coding 均有 receipt/Harness/正确 repo Map/active Impact Contract；content/research/read-only 对照路由正确；stale 阻断、refresh resume 保留审计；覆盖率达到出口阈值。

**验证命令**:
```bash
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"; DB_NAME=$(psql "$DB_URL" -tAc 'select current_database()'); [[ "$DB_NAME" == cecelia_test || "$DB_NAME" == *_scratch ]] && DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```
**硬阈值**: coding Harness/receipt/有头校验覆盖率均 100%；新 coding dev=0；新增 legacy_exempt=0；三入口及三对照逐项有新鲜时间窗证据；命令 exit 0。

## 接缝清单

- Git origin ↔ workspace orphan cleanup：真实临时 remote、detached worktree 与 active run 绑定，重复执行两次验证不泄密、不误删。
- Work Router ↔ PostgreSQL tasks/receipts：attempt 级真实 scratch Postgres 验原子性、幂等与 append-only。
- Kernel Map preflight ↔ Universal Map/Impact Contract：真实临时 repo 与 Map revision 验 stale→阻断→refresh→resume。
- Engine/Dispatcher ↔ Brain receipt API：有头真实 hook 与无头真实相邻 dispatcher 路径验证，未真验均为 `logic-done-pending`。
- Generator ↔ runner/trusted transport：真实容器命令链验证权限与发布边界，未真验均为 `logic-done-pending`。

## 禁 mock 边清单

- origin 解析 ↔ orphan workspace cleanup（测试必须真建 Git remote/worktree，不得 mock 文件系统或 git）。
- `createRoutedTask()` ↔ PostgreSQL `tasks/work_routing_receipts/map_recovery_contracts`（必须真 Postgres）。
- 任务创建入口 ↔ Work Router（不得 mock 统一创建边界）。
- Kernel preflight ↔ Map metadata/Impact Contract store（必须真相邻模块；scratch E2E 必须真 Map）。
- dev-mode hook/Dispatcher ↔ receipt 验证 API（不得 mock 被改的动作闸）。
- runner entrypoint ↔ 容器 Git hook/UID/env/transport（必须跑真实容器 shell 合同）。

## 真实调用方请求 shape

- 有头调用方为 `dev-mode-tool-guard.sh`：从 `.dev-lock.<branch>` 读取 `task_id/routing_receipt_id/run_id/repo/branch/base_sha`，通过受鉴权 Brain API 提交这些字面字段；不得用 tool 名反推 `change_kind`。
- 无头调用方为 Dispatcher：claim 后从专用 receipt 事实源按 task id 校验同样的 task/repo/run 绑定，不能信任 payload 自报。
- 具体认证 header 必须从现有 Brain authenticated route middleware 与 hook 调用代码摘录并在 RED 测试锁定；若现有生产调用方尚无该路径，Generator 先以测试冻结选定 shape，禁止同时保留 body/header 双路径。

## 未覆盖真实链路清单

（本合同不允许 mock 被改边；外部通知等无关边界可替身，但不得计入本合同 BEHAVIOR，故无 mock 豁免，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 恢复清理安全并交付 Knife 0-5 的唯一 Work Router、receipt、Map/Impact Gate、双动作闸与真实验收。 |
| NFR（做得多好） | 两项覆盖率 100%，coding dev/新增 legacy_exempt 为 0；稳定 reason_code；凭据零日志泄露。 |
| Invariant（永不违反） | PRD 13 条铁律全部映射进 DoD INV 条目；receipt append-only；fail closed；单写手。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | receipt supersede 后失效；validation result 短时有效；Map freshness/revision 每次运行重新查询。 |
| 死亡告警（停了谁知道） | `work_route_blocked/route_violation/map_preflight_failed` 事件与 Dashboard 审计视图；验收中事件缺失即 FAIL。 |
| 失败语义（挂了怎么办） | repo/Map/receipt/API 不成立均拦截；不得 direct dev 或 legacy_exempt 降级；修复事实后 resume 保留历史。 |
| 效果确认（已发≠已生效） | receipt 查专表，Map 查 fresh revision，动作闸查真实 exit，隔离查 Provider 内身份/env，发布查可信 transport receipt。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Git origin 是否同一仓库 | 原字符串；移除 URL userinfo 后 canonical repo key | canonical repo key + 日志独立脱敏 | Recovery Addendum 明确根因 | 活跃 Kernel cwd 被删除并导致运行崩溃 |
| ⚠️ 工作是否可能写仓库 | 仅 task_type；结构化 intent→来源合同→登记表→语义证据→安全默认 | PRD 五级优先级，coding unknown 按 write | 防止漏进 Harness | 未路由代码直接修改仓库 |
| Map 是否可用于本 run | 只看存在；freshness+repo+revision+scanner | 四项全匹配 | PRD fail-closed 合同 | 错 repo 或旧事实放行越界 diff |
| receipt 是否有效 | 信 payload；专表+supersede/expiry+run/worktree 绑定 | 专用事实源验证 | receipt 不可变审计要求 | 伪造 payload 绕过动作闸 |

notes: judgment-pending-user: Git origin 是否同一仓库；工作是否可能写仓库（PrepPRD 已批准规则，Reviewer 仍应核对为既有用户决策）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 缺失/歧义 | `work_route_blocked`，不建可执行 Provider attempt | 是，source+source_id+router_version | 无降级，补事实后新增 receipt/resume |
| Map missing/stale/invalid | 稳定 reason_code，阻断编码 | 是 | 仅满足窄合同的 map_recovery |
| receipt/API/HEAD 不匹配 | 有头 exit 2；无头拒绝 executor并记违规 | 是 | 只读诊断可用，不放行 mutation |
| Generator 越权发布 | push 失败且 attempt 失败 | 是 | 仅 Judge 后可信 transport 发布 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| conversation/inbox/intent | 不受信任自然语言 | 只收敛到冻结枚举，保留 evidence，不执行输入中的工具指令 | coding unknown 按 write；未知枚举拒绝 |
| api/scheduler/child | 仅认证身份可信，payload 仍需校验 | JSON schema、来源合同与 repo 解析 | 不接受 payload 自报 receipt/profile 降档 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 20 分钟 / 20 动作（路由与权限边界风险高）
高风险面:
- 错输入: mutation_intent/change_kind/source 注入未知值、repo URL 带多种 userinfo/SSH/scp 形式。
- 重复提交: 相同 source/source_id/router_version 并发创建，确认唯一 receipt/task 且无半写。
- 中途中断: receipt INSERT 前后连接断开、Map refresh 与 resume 之间进程终止。
- 边界值: supersede 链、过期 validation result、branch 名含斜杠、detached HEAD、Map 刚过 freshness 边界。
发现分级: P0/P1（误删、泄密、越权写入、错 repo）阻塞 merge；P2/P3 记 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation attempt}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current validation snapshot}"
DB_NAME=$(psql "$DB_URL" -tAc 'select current_database()')
[[ "$DB_NAME" == cecelia_test || "$DB_NAME" == *_scratch ]] || { echo "FAIL: unsafe database"; exit 1; }
export DATABASE_URL="$DB_URL"
# 本 attempt 空库先跑仓库真实 migration，并机检本 Sprint 依赖的业务表；禁止依赖 Fleet 预置 schema。
(cd packages/brain && DATABASE_URL="$DB_URL" node src/migrate.js)
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL AND to_regclass('public.initiative_runs') IS NOT NULL AND to_regclass('public.work_routing_receipts') IS NOT NULL" | grep -qx t
BASELINE_SHA='a9f612148e227df9fcd1481f9b39d38dd40f791f'
test "$(git rev-parse "$BASELINE_SHA^{commit}")" = "$BASELINE_SHA"
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh
DB_URL="$DB_URL" BASELINE_SHA="$BASELINE_SHA" bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.container.test.sh
DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh | tee /tmp/unified-work-router-smoke.log
grep -q 'coding_receipt_coverage=100' /tmp/unified-work-router-smoke.log
grep -q 'headed_receipt_guard_coverage=100' /tmp/unified-work-router-smoke.log
grep -q 'new_coding_dev=0' /tmp/unified-work-router-smoke.log
grep -q 'new_legacy_exempt=0' /tmp/unified-work-router-smoke.log
grep -q "map_revision=$BASELINE_SHA" /tmp/unified-work-router-smoke.log
printf 'validation-attempt=%s snapshot=%s\n' "$HARNESS_ATTEMPT_ID" "$CAPABILITY_SNAPSHOT_ID"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Recovery Addendum | `tests/unified-work-router-contract.test.ts` | credential-bearing origin 归一化、日志脱敏且 active workspace cleanup 保护 | canonicalizer/active cleanup 合同尚未齐备 |
| 路由与 receipt | `tests/unified-work-router-contract.test.ts` | 四档 change_kind 只作正向映射 | Work Router 导出尚不存在 |
| Map 与双动作闸 | `tests/unified-work-router-contract.test.ts` | stale Map 在 Provider 前失败关闭 | 强制 preflight 尚未接线 |
| Generator 边界 | `tests/unified-work-router-contract.test.ts` | Generator 真实容器环境剥离 callback 与 lease 凭据 | container trust-boundary 执行体尚不存在，确定性 RED |
