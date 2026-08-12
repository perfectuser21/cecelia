# Sprint Contract Draft（Round 1）

## 证据来源与边界

- 冻结 PRD：`sprint-prd.md`、bundle `thin_prd` 与 `prep_prd_body`；冲突时 Recovery Contract Correction 优先。
- 冻结实现基线：`22a62578f0aab77c58e1e0be25a6c321a78b35ad`。它是血统与治理证据基点，不是完成态 HEAD。
- Universal Map：scope=`cecelia`，查询时 freshness=`fresh`；四类 scanner 为 `api-registry-v2/db-schema-v2/graph-v3/test-registry-v2`。事实 revision 为 `5d1d7417bd015c5c1018718e3c53e827c2a106f1`，与冻结实现基线不同，故实现运行必须重新刷新并把本次 Impact Contract 的 `base_sha/source_revision` 锚定到冻结基线。
- `[MAP_NOT_CONFIGURED]`：task payload 有 `map_scope=cecelia`，但 `map_repo` 为空，因此 radius 未成立，`must_run_assertions=[]`；禁止以领域硬编码补造 radius 断言。
- Registry：api/db_schema/test 均可查询；字段以 PRD 字面合同优先。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面）

### Internal contracts: NormalizedWorkRequest / RouteDecision / RoutingReceipt

本 Sprint 不新增面向用户的独立 HTTP response schema；动作期 receipt 验证 API 复用以下 PRD 字面字段：`work_kind`、`change_kind`、`pipeline`、`canonical_task_type`、`default_execution_profile`、`repo`、`map_scope`、`impact_contract_required`、`router_version`、`route_reason`、`evidence`、`decided_at`。Routing Receipt 另含 `id/task_id/source/source_id/supersedes_receipt_id/created_at`。未知枚举、缺 repo 的 coding mutation 和无效 receipt 必须返回稳定 `reason_code` 并 fail closed。

禁用语义：不得把 `gear`、实际 stage、旧 `task_type` 或完成态 HEAD 反推为 `change_kind/base_sha`；不得以 payload 投影替代专表 receipt。

## 已知约束（来自回归测试与历史）

- `packages/brain/src/__tests__/harness-worktree.test.js` → 已有 worktree 复用、origin 不匹配重建与异常路径。
- `packages/brain/src/__tests__/harness-worktree-state-validation.test.js` → `.git` 状态必须在复用前验证。
- `packages/brain/src/__tests__/startup-recovery-active-container-protect.test.js` → 活跃容器挂载工作区不得被孤儿清理。
- `docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh` → frozen-baseline pre-push 与退出 lineage guard 必须保留。
- `[累积FR]` context-manifest 本轮未返回可解析摘要；按 PRD/Recovery Addendum 的永久回归约束执行。
- Brain 代码改动前必须依次通过 facts-check、version-sync、DoD mapping；失败即停止编码。

## Golden Path

覆盖父路 Unified Work Router Knife 0-5 第 1-10 步

[恢复前置 RED/GREEN] → [统一路由与不可变凭证] → [全入口收敛] → [Map/Impact Contract] → [有头/无头动作闸] → [Generator 信任边界] → [迁移与 scratch 真验]

### Step 1: 恢复 Harness 工作区安全
**来源**: `[FROM_PRD]` — Recovery Addendum 要求先永久复现并修复三项故障。

**可观测行为**: 含凭据和不含凭据的同一 Git origin 被视为同仓；日志不出现 userinfo/token；活跃 Kernel run 的 detached cwd 不被 `ensureHarnessWorktree` 删除。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/harness-worktree*.test.js src/__tests__/startup-recovery-active-container-protect.test.js
```
**硬阈值**: 三类回归全部通过且日志敏感值命中数为 0；由上述 Vitest 的精确断言执行验证。

### Step 2: 生成确定性路由与不可变 Routing Receipt
**来源**: `[FROM_PRD]` — PRD §7-9、Knife 0-1。

**可观测行为**: `coding_mutation` 唯一得到 `harness/harness_initiative`；四种 change_kind 仅正向映射；task 与 receipt 同事务落库且 receipt 不可 UPDATE/DELETE。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js
```
**硬阈值**: 四档映射 4/4；原子回滚、幂等、append-only 均通过；测试使用真 PostgreSQL，不 mock `createRoutedTask ↔ DB`。

### Step 3: 收敛所有任务创建入口
**来源**: `[FROM_PRD]` — PRD §12、Knife 0-2。

**可观测行为**: `VALID_TASK_TYPES` 实时计数且无重复；入口 inventory 逐项覆盖主线扫描结果；Planner/Proposal/Capture 三陷阱永久回归；可执行 coding 入口均委托 `createRoutedTask()`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js
```
**硬阈值**: inventory 无漏项、无未经 allowlist 的业务 `INSERT INTO tasks`；不得用总数替代逐入口证据。

### Step 4: 强制 fresh Map 与 Impact Contract
**来源**: `[FROM_PRD]` — PRD §10、Knife 3。

**可观测行为**: repo/freshness/revision/scanner 任一不成立时 Provider attempt 不创建；正常 run 的 policy 恒为 required；map_recovery 仅可单次修复 allowlist，之后全 scanner 同 revision 且 fresh。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js
```
**硬阈值**: fresh 正例通过；missing/stale/revision mismatch/scanner invalid/cross-repo/过期或复用 recovery 全部 fail closed。

### Step 5: 有头与无头动作前强制 receipt
**来源**: `[FROM_PRD]` — PRD §12、Knife 4。

**可观测行为**: mutation-capable tool 在缺 session/lock/receipt 或字段不匹配时 exit 2；只读诊断不误伤；Dispatcher 在 executor 前拒绝无效 receipt 并记录 route_violation。

**验证命令**:
```bash
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js
```
**硬阈值**: 所有非法矩阵均拒绝，合法有头/无头各通过一次，route_violation 恰有本轮记录。

### Step 6: Generator frozen baseline 与信任边界
**来源**: `[FROM_PRD]` — Knife 3-4 与 Recovery Contract Correction。

**可观测行为**: Provider 无 push/callback/lease 凭据且以降权身份运行；基线只要求为最终 HEAD 祖先；receipt、Map、Impact Contract 仍精确记录冻结 baseline。

**验证命令**:
```bash
bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh && BASELINE_SHA=22a62578f0aab77c58e1e0be25a6c321a78b35ad git merge-base --is-ancestor "$BASELINE_SHA" HEAD
```
**硬阈值**: ancestry exit 0 且 `git rev-parse HEAD` 可以、并应在实现完成后不同于 baseline；RED/GREEN commits 永久存在。

### Step 7: scratch 多入口真实验收
**来源**: `[FROM_PRD]` — PRD §16.6、Knife 5。

**可观测行为**: API/Intent/Capture 三个 coding 请求均有 receipt、Harness run、正确 repo Map 与 active Impact Contract；content/research/review 对照不误入；stale Map 阻断后刷新可 resume 并保留审计。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```
**硬阈值**: 三个 coding 入口 3/3；对照 3/3；新 coding dev 直接派发=0；新 legacy_exempt=0；receipt coverage=100%。

## 真实调用方请求 shape

- 有头 hook：`.dev-lock.<branch>` 必须字面包含 `task_id/routing_receipt_id/run_id/repo/branch/base_sha`，通过受认证 Brain API 验证；不得把这些字段挪入工具命令 body 后自行判定。
- 无头 Dispatcher：从 task payload 只取 `routing_receipt_id` 投影，以专表 receipt 为事实源，并与 active run/attempt、repo、branch、base SHA 核对。
- Harness 启动：Routing Receipt 的 `repo/map_scope/change_kind` 正向供 Kernel 选择 profile 与 Map；不得从 gear/stage 反推。

## 禁 mock 边清单

- `ensureHarnessWorktree` ↔ Git remote/worktree filesystem（凭据归一化、脱敏、活跃 cwd 保护必须用真实临时 Git repo）。
- `createRoutedTask` ↔ PostgreSQL `tasks/work_routing_receipts/map_recovery_contracts`（原子性、幂等、append-only 必须真 PostgreSQL）。
- Work Router ↔ Brain API/Intent/Capture/Planner/Proposal/Scheduler/child spawn（被收敛入口不得 mock 掉统一创建边界）。
- Kernel preflight ↔ Universal Map/Impact Contract/run store（被改接缝必须真相邻模块与真实临时 repo）。
- dev-mode tool guard ↔ `.dev-lock`/Brain receipt validation API/真实 worktree；Dispatcher ↔ executor 前 route guard。
- runner entrypoint ↔ Git hooks/setpriv/environment/受信 transport（须在容器命令链真验）。

## 接缝清单

1. Git origin/worktree：真实临时 repo 两次执行；凭据 URL 与无凭据 URL 等价且日志无泄露。[接缝×2]
2. Brain ↔ PostgreSQL：attempt 隔离 scratch DB 中验证事务、receipt 与时间窗；未真验前为 `logic-done-pending`。[接缝×2]
3. Runner container ↔ Git/UID/env：真实容器断言 Provider push 失败、callback token 不可见、trusted transport 可发布。[接缝×2]

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 唯一 Work Router、不可变 receipt、Map/Impact 强制门禁、全入口收敛、动作闸与 Generator 隔离。 |
| NFR | coding Harness 覆盖率 100%，无 receipt 新业务任务 0，新 legacy_exempt 0；稳定 reason_code。 |
| Invariant | coding mutation 只能进 Kernel Harness 2.0；四档只正向映射；冻结 baseline 是祖先而非完成 HEAD。 |
| 判定点 | 见下表。 |
| 保质期 | receipt 不过期但可被后继 supersede；validation result 短时有效；Map freshness 按系统阈值实时计算。 |
| 死亡告警 | `work_route_blocked/route_violation/map_preflight_failed` 事件与核心指标立即暴露，禁止静默降级。 |
| 失败语义 | repo/Map/receipt 不成立均 fail closed；只允许窄化、单次、过期受控的 map_recovery。 |
| 效果确认 | DB receipt、active Impact Contract、真实 diff gate、runner 隔离和 scratch 多入口查询交叉确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ coding mutation 判定 | task type 单点；结构字段+来源合同+登记表+语义 | 后者且 unknown coding 按 write | PRD §9 | 漏入直接写路径 |
| ⚠️ Git origin 同一性 | 原字符串；移除 userinfo 后 canonical URL | canonical URL | Recovery Addendum | 活跃 cwd 被误删且凭据泄露 |
| Map 可用性 | 文件存在；freshness+revision+scanner | 后者 | PRD §10 | stale 事实指导实现 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 不唯一/receipt 无效 | 阻断并记录稳定 reason_code | source+source_id+router_version 幂等 | 无直接开发降级 |
| Map stale/missing | 不创建 Provider attempt | 刷新后 resume 并保留审计 | 仅合法 map_recovery |
| route guard API 不可达 | mutation exit 2/Dispatcher 拒绝 | 是 | 只读诊断仍可用 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| API/Conversation/Thalamus/Discovery/Scheduler/Child | 不受信 | 仅收敛到枚举与版本化来源合同，保存 evidence | 未知 coding 按 write；未知枚举/repo fail closed |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 20 分钟 / 20 动作（路由与权限边界高风险）
高风险面:
- 错输入: `declared_change_kind="hotfix"`、空 repo、未知 source。
- 重复提交: 同一 source/source_id/router_version 并发创建两次。
- 中途中断: task INSERT 后 receipt INSERT 故障；Map 刷新中 Provider claim。
- 边界值: origin 带 percent-encoded userinfo、scp/ssh/https 等价 URL、detached active cwd。
发现分级: P0/P1（绕过 Harness、删活跃工作区、泄露凭据）阻塞 merge；P2/P3 记 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current execution identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
BASELINE_SHA=22a62578f0aab77c58e1e0be25a6c321a78b35ad
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export DATABASE_URL="$DB_URL"
cleanup() { test -z "${BRAIN_PID:-}" || kill "$BRAIN_PID" 2>/dev/null || true; }
trap cleanup EXIT

git merge-base --is-ancestor "$BASELINE_SHA" HEAD
test "$(git rev-parse HEAD)" != "$BASELINE_SHA"

node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs

cd packages/brain
npm run migrate -- --database-url "$DB_URL"
psql "$DB_URL" -tAc "SELECT to_regclass('work_routing_receipts') IS NOT NULL" | grep -qx t
DATABASE_URL="$DB_URL" node src/server.js >/tmp/unified-router-brain.log 2>&1 & BRAIN_PID=$!
for i in $(seq 1 60); do curl -sf http://127.0.0.1:5221/api/brain/health >/dev/null && break; test "$i" -lt 60 || exit 1; sleep 1; done
cd ../..

bash packages/brain/scripts/smoke/unified-work-router-smoke.sh

psql "$DB_URL" -v baseline="$BASELINE_SHA" -v started="$STARTED_AT" -tAc "SELECT count(*) FROM work_routing_receipts r JOIN tasks t ON t.id=r.task_id WHERE r.created_at >= :'started'::timestamptz AND r.work_kind='coding_mutation' AND r.pipeline='harness' AND r.canonical_task_type='harness_initiative' AND r.evidence->>'base_sha'=:'baseline'" | grep -qx 3
psql "$DB_URL" -v started="$STARTED_AT" -tAc "SELECT count(*) FROM work_routing_receipts WHERE created_at >= :'started'::timestamptz AND work_kind='coding_mutation'" | grep -qx 3
! grep -Eiq '(https?://)[^/@[:space:]]+@|token=[^[:space:]]+' /tmp/unified-router-brain.log
echo "PASS attempt=$HARNESS_ATTEMPT_ID capability_snapshot=$CAPABILITY_SNAPSHOT_ID"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Recovery + Router + Gate | `tests/unified-work-router-contract.test.ts` | `credential-bearing origin 不得误判 orphan`；`冻结 baseline 必须是最终 HEAD 祖先`；`四种 change_kind 正向映射`；`coding mutation 必须原子创建 receipt`；`Map 与 Impact Contract 必须锚定 baseline`；`Generator trust boundary 必须 fail closed` | 当前缺少统一路由模块、receipt migration 与完整门禁而失败 |

