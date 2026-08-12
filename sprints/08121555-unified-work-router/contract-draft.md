# Sprint Contract Draft (Round 2)

## Round 1 blocker closure

- R1-1：锁定 RED 测试改为执行真实临时 Git remote/workspace、真实 PostgreSQL、真实 Map/Provider 计数、真实 hook/Dispatcher 和真实 runner 子进程断言，不再以导出符号存在作为通过条件。
- R1-2：Golden Path 新增 Knife 5 旧任务迁移、事件、Dashboard 与生产只读指标步骤，DoD B-08/B-09 对 dry-run、running attempt、事件和指标分别给出可执行 oracle。
- R1-3：Routing Receipt 数据合同改为允许同一 task 多个 receipt，并以 partial unique current-receipt 约束与 supersedes 链测试保证后继历史。
- R1-4：新增 TDD commit ledger 条款和 B-10，逐 Knife 检查 RED commit 祖先早于对应 GREEN commit，且 RED 树上的指定 Vitest 必须非零、GREEN 树上必须为零。

## 证据来源与已知约束

- PRD 正文：`inputs.thin_prd` 与 `inputs.prep_prd_body`（优先），补充读取 `sprint-prd.md`。
- Unified Map：scope=`cecelia`、freshness=`fresh`、fact revision=`310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`；但 task payload 缓存的 `map_repo` 为空，标记 `[MAP_NOT_CONFIGURED]`，不得用领域硬编码补 repo。
- Map radius：因 `map_repo/expected_files` 缺失，`affected_business_nodes=[]`、`must_run_assertions=[]`；无额外 Map 强制断言。
- `[回归测试] packages/brain/src/__tests__/harness-worktree.test.js`：既有工作区复用、重建和清理合同不得回退。
- `[回归测试] packages/brain/src/__tests__/harness-worktree-cross-repo.test.js`：跨 repo worktree 必须绑定显式 baseRepo。
- `[累积FR]` PRD 明确本 line 暂无历史；context-manifest 无新增约束。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面）

本 Sprint 同时新增/收敛多个内部 API；事实源是 PRD §8 的数据契约，不另造同义字段。

### Endpoint: POST /api/brain/tasks

**Success (HTTP 201)**：返回 task 投影，至少包含 `id`、`task_type`、`routing_receipt_id`；其中 coding mutation 的 `task_type` 字面等于 `harness_initiative`。完整 receipt 只能从鉴权查询端点读取。

### Endpoint: POST /api/brain/work-routing/validate

**Success (HTTP 200)**：`{"valid":true,"routing_receipt_id":"<uuid>","task_id":"<uuid>","reason_code":"route_valid"}`。

**Error (HTTP 4xx/503)**：`{"valid":false,"reason_code":"<stable_code>"}`。

**禁用字段名**：`receipt`（不得把完整凭证塞回 task payload）、`gear_inferred_change_kind`、`legacy_exempt`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 所有 coding mutation 由唯一 Work Router 原子生成 task 与不可变 receipt，并经 Map/Impact Contract、动作闸和 Kernel Harness 2.0。 |
| NFR（做得多好） | coding receipt coverage=100%，新 `legacy_exempt=0`；所有失败给稳定 reason_code；凭据不进日志。 |
| Invariant（永不违反） | 不默认 repo、不反推 change_kind、不降掉 Evaluator/Judge/merge fence、receipt append-only、Provider 无发布与 callback 权限。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | receipt 由 router_version 与 supersedes 链判活性；Map freshness、recovery contract 和 validation result 按各自时间窗过期。 |
| 死亡告警（停了谁知道） | `work_route_blocked`、`route_violation`、`map_preflight_failed` 事件及 Dashboard 指标让值守方在下一 tick/请求内发现。 |
| 失败语义（挂了怎么办） | fail closed；不改 payload 自救，不产生 legacy_exempt；修复 repo/Map 后以 resume 或后继 receipt 恢复。 |
| 效果确认（已发≠已生效） | DB 真查 receipt/run/Impact Contract，Provider attempt 未提前创建；容器真验 Provider push/敏感环境阻断及 trusted transport 发布。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ coding mutation 判定 | 显式字段/来源合同/task type/语义 | 按固定优先级收敛；coding unknown 按 write | PRD §9 | 漏路由导致未受控写入 |
| ⚠️ repo 唯一性 | cwd 默认/receipt 显式事实 | 只接受唯一解析的规范 repo key | PRD §7.3 | 跨 repo 污染 |
| Map 可用于本轮 | 仅 health/freshness+revision+scanner | 三者联合且与 baseline 一致 | PRD §10 | 过期事实驱动错误 diff |

notes: judgment-pending-user: coding mutation 判定、repo 唯一性（设计已由用户批准，本轮只按批准口径实施）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 未知/歧义 | 路由阻塞，稳定 reason_code | 是，source/source_id/router_version 幂等 | 无默认 repo |
| receipt 缺失/过期/superseded/API 不可达 | 动作前 exit 2 或 Dispatcher 拒绝，记录 route_violation | 是 | 只读诊断保留 |
| Map stale/missing/invalid | Provider 前失败 | 是 | 仅满足窄合同才 map_recovery |
| task/receipt 任一写入失败 | transaction 整体回滚 | 是 | 无部分成功 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| API/Intent/Capture/Scheduler/child 的任务描述 | 不受信任 | 只收敛到严格枚举，结构化证据优先，自由文本不能取得写权限 | 未知 coding 按 write；未知枚举、降档、隐式 repo 均拒绝 |

## 真实调用方请求 shape

- Brain API、Intent、Capture、Actions、Scheduler 与 child spawn 只提交 `NormalizedWorkRequest`：`source/source_id/title/mutation_intent` 必填，其他字段按 PRD §8.1；不得直接决定最终 `task_type` 后 INSERT。
- 有头 Engine hook 从 `.dev-lock.<branch>` 读取 `task_id/routing_receipt_id/run_id/repo/branch/base_sha`，以受认证 Brain API 调 `POST /api/brain/work-routing/validate`；认证沿用 Brain 内部 API 既有 header，不在 body 伪造主体。
- 无头 Dispatcher 从已 claim task 的 `routing_receipt_id` 投影查询专用 receipt，并在 executor 前验证；payload 中伪造完整 receipt 无效。

## 禁 mock 边清单

- `createRoutedTask` ↔ PostgreSQL `tasks/work_routing_receipts/map_recovery_contracts`（事务、幂等、append-only 必须真 PostgreSQL）。
- Work Router ↔ Brain API/Intent/Capture/Actions/Scheduler/child 创建入口（入口集成测试不得 mock Work Router）。
- Kernel preflight ↔ Universal Map/Impact Contract store（用真实测试 DB 与临时 Git repo，不 mock 被改的数据传递边）。
- Engine hook/Dispatcher ↔ receipt validation（真临时 worktree、真 validation API 或真相邻模块；只可替换更外层网络 transport）。
- runner entrypoint ↔ Provider 子进程环境/Git hook（真实容器命令链，不以字符串检查替代）。
- orphan cleanup ↔ 活跃 Kernel workspace registry/Git remote canonicalizer（真临时 Git remote/worktree，不 mock 删除判定边）。

## 未覆盖真实链路清单

（本合同禁止 mock 上述被改边；第三方 API 不在范围内，无 mock 豁免，N/A。）

## 接缝清单

- `[接缝×2]` 真实 PostgreSQL 原子路由与 Map/Impact Contract：在 attempt-scoped scratch DB 重复执行两次，按唯一 source key 断言无半条 receipt、无跨 repo 事实。
- `[接缝×2]` 有头临时 worktree 与无头 Dispatcher：真实 hook/API/HEAD 状态重复执行两次，任一不一致均 fail closed。
- 真实 runner 容器的 Generator trust boundary：动作含非幂等发布验证，不重复执行；留证中记录单次容器 ID、commit 与 transport receipt。

## Golden Path

覆盖父路 PrepPRD「Knife 0-5」第 1-8 步。

[真实入口] → [恢复工作区安全] → [原子路由] → [全入口收敛] → [Map/Impact preflight] → [动作闸与 Generator 隔离] → [scratch 审计出口]

### Step 1: 恢复 origin 与活跃 Kernel 工作区安全
**来源**: `[FROM_PRD]` — Golden Path 第 1 步与 RECOVERY ADDENDUM。
**可观测行为**: 含凭据和无凭据 GitHub origin 归一化为同一仓库；诊断日志无 userinfo/token；活跃或 detached Kernel cwd 不被 orphan cleanup 删除。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/harness-worktree-origin-safety.test.js`
**硬阈值**: 三个回归场景全部通过且 secret 字面值在 log 中出现 0 次；由上述 Vitest 断言机检。

### Step 2: 原子创建不可变 Routing Receipt 并正向选择四档
**来源**: `[FROM_PRD]` — Golden Path 第 2 步、PrepPRD §7-9、Knife 0-1。
**可观测行为**: 同一事务创建 task+receipt；失败全回滚；receipt UPDATE/DELETE 被拒；同一 task 可通过新增 receipt 形成 `supersedes_receipt_id` 历史链，且任一时刻只有一个未被 supersede 的 current receipt；四个 change_kind 唯一映射默认 profile，反向推导和降档失败。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/__tests__/integration/work-routing-store.integration.test.js`
**硬阈值**: 4/4 映射正确、0 个部分写入、UPDATE/DELETE 100% 拒绝、同 task 两个 receipt 构成长度 2 的无环链且 current receipt 恰为 1；由测试和 DB 行数断言机检。Migration 禁止 `task_id UNIQUE`，改用 current receipt 的 partial unique index。

### Step 3: 全部可执行任务入口收敛
**来源**: `[FROM_PRD]` — Golden Path 第 3 步、Knife 2。
**可观测行为**: 冻结清单逐项通过同一创建边界；coding 成为 harness_initiative；非 coding 不误路由；Planner/Proposal/Capture 三陷阱永久回归。
**验证命令**: `cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js`
**硬阈值**: `VALID_TASK_TYPES` 动态值唯一、inventory 每项有入口合同、禁止扫描命中数=0；测试直接断言，不复制 70/33 为实现常量。

### Step 4: fresh Map 与 required Impact Contract 前置 Provider
**来源**: `[FROM_PRD]` — Golden Path 第 4-5 步、Knife 3。
**可观测行为**: 同 repo fresh Map 才建立 required Impact Contract；missing/stale/revision/scanner/cross-repo 在 Provider attempt 前失败；map_recovery 仅窄合同单次消费并完成全量重扫。
**验证命令**: `cd packages/brain && npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js`
**硬阈值**: 所有新 coding run policy=required、新 legacy_exempt=0、失败路径 Provider attempt=0；测试真 DB/临时 repo 断言。

### Step 5: 有头/无头动作闸与 Generator 信任边界
**来源**: `[FROM_PRD]` — Golden Path 第 6-7 步、Knife 4。
**可观测行为**: mutation-capable tool 与 Dispatcher 都在动作前验证同一 receipt；非法状态 fail closed；Generator 无 push/callback/lease 能力且降权，trusted transport 仅 Judge 后发布。
**验证命令**: `bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js && cd ../.. && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh`
**硬阈值**: 非法矩阵 exit=2/拒绝率 100%，Provider secret 可见数=0、直接 push 成功数=0；由脚本退出码与明确断言机检。

### Step 6: scratch 多入口真实验收与审计出口
**来源**: `[FROM_PRD]` — Golden Path 第 8 步、Knife 5。
**可观测行为**: API/Intent/Capture 三项 coding 均有 receipt/Harness/正确 Map/active Impact Contract；三类对照走各自 pipeline；stale 阻断后 refresh/resume 保留失败审计。
**验证命令**: `DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh`
**硬阈值**: coding coverage=100%、新 legacy_exempt=0、对照误路由=0、stale 时 Provider=0；smoke 内 psql 时间窗查询机检。

### Step 7: 旧任务迁移与可观测性收口
**来源**: `[FROM_PRD]` — PrepPRD §13、§14、§17 与实施计划 Task 5。
**可观测行为**: dry-run 报告 queued/blocked/paused coding 分类、repo 解析率和阻塞清单且不写库；apply 保留 task id/payload 并追加 receipt；running attempt 只写 legacy_execution_audit；事件和 Dashboard 展示 work kind/pipeline/repo/Map/Impact Contract/reason；生产只读指标可查询。
**验证命令**: `cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-routing-migration-observability.integration.test.js --reporter=verbose && cd ../.. && npx vitest run apps/dashboard/src/pages/warroom/WarRoomPage.test.tsx --reporter=verbose`
**硬阈值**: dry-run 前后 DB checksum 相同；未开始 coding 任务 id/payload 保持且新增后继 receipt；running task 状态/attempt 不变且 audit=1；六类事件/指标断言和 Dashboard 可见字段全部通过。

### Step 8: RED→GREEN 提交账本与 DevGate、CI 收口
**来源**: `[FROM_PRD]` — DoD 第 8 条与实施计划 Task 5。
**可观测行为**: RECOVERY 与 Knife 0-5 每项均有独立 RED commit 早于对应 GREEN commit；RED 树执行锁定测试非零，GREEN 树同测试为零；Brain patch version/DEFINITION 同步，三项 DevGate、smoke、diff check 与 required CI 全绿。
**验证命令**: `bash packages/brain/scripts/verify/unified-work-router-tdd-history.sh && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && bash packages/brain/scripts/smoke/unified-work-router-smoke.sh && git diff --check`
**硬阈值**: ledger 覆盖 `recovery,knife0,knife1,knife2,knife3,knife4,knife5` 七项；每项 `git merge-base --is-ancestor RED GREEN` 为真、SHA 不同、RED 测试 exit!=0、GREEN 测试 exit=0；其余每条命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 15 分钟 / 20 动作（路由与权限边界高风险，增加 5 分钟）
高风险面:
- 错输入: POST /api/brain/tasks 传未知 mutation_intent/change_kind、空 repo、冲突 repo hints。
- 重复提交: 同 source/source_id/router_version 并发提交两次，确认只产生一个当前 receipt/task。
- 中途中断: task INSERT 后、receipt INSERT 前模拟 transaction 错误；Provider 启动前让 Map 过期。
- 边界值: supersedes 链、expires_at 临界、credential origin 的编码 userinfo、detached HEAD 与符号链接 cwd。
发现分级: P0/P1（未受控写入、删活跃 cwd、凭据泄露、跨 repo）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current evaluator attempt identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
export DATABASE_URL="$DB_URL"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
test "$(psql "$DB_URL" -tAc 'SELECT current_database()' | tr -d ' ')" != "cecelia"
for migration in packages/brain/migrations/*.sql; do psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null; done
psql "$DB_URL" -tAc "SELECT to_regclass('work_routing_receipts') IS NOT NULL" | grep -qx t
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
DB_URL="$DB_URL" HARNESS_ATTEMPT_ID="$HARNESS_ATTEMPT_ID" CAPABILITY_SNAPSHOT_ID="$CAPABILITY_SNAPSHOT_ID" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh | tee /tmp/unified-work-router-e2e.log
grep -q 'SCRATCH_ACCEPTANCE_OK' /tmp/unified-work-router-e2e.log
psql "$DB_URL" -tAc "SELECT count(*) FROM work_routing_receipts WHERE created_at >= '$STARTED_AT'" | awk '$1 >= 3 {ok=1} END {exit !ok}'
bash packages/brain/scripts/verify/unified-work-router-tdd-history.sh
git diff --check
```

通过标准：脚本 exit 0；使用 attempt-scoped 非生产空库，经仓库真实 migrations 初始化；smoke 自行通过真实创建入口产生业务状态，不直接 INSERT 业务身份/session。当前执行身份只读取 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，不固化本轮 Proposer 身份。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 恢复前置 | `tests/worktree-origin-safety.test.ts` | 含凭据 origin 等价且日志脱敏、活跃 Kernel cwd 不被删除 | 缺安全 canonicalizer/active workspace guard 而失败 |
| 路由与四档 | `tests/unified-work-router.test.ts` | 四档 change_kind 只正向映射、coding unknown 按 write | 模块不存在而失败 |
| 数据与入口 | `tests/routing-receipt.integration.test.ts` | task 与 Routing Receipt 原子创建且 append-only、入口委托统一边界 | store/migration 不存在而失败 |
| Map 与动作闸 | `tests/map-action-gates.integration.test.ts` | stale Map 在 Provider 前失败、有头无头 receipt 均在动作前验证 | preflight/validation API 不存在而失败 |
| 信任边界 | `tests/generator-trust-boundary.test.ts` | Generator 不持有 push callback lease 凭据 | 统一隔离尚未接线而失败 |
| 迁移与可观测性 | `tests/migration-observability.integration.test.ts` | dry-run 不写库、未开始任务追加 receipt、running attempt 只审计、事件指标可见 | 迁移与观测实现不存在而失败 |
| TDD 历史 | `tests/tdd-history.test.ts` | 七项 RED commit 均早于 GREEN 且在各自树上红/绿 | ledger/对应 commits 不存在而失败 |
