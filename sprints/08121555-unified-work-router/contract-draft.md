# Sprint Contract Draft (Round 3)

## 证据来源与运行边界

- 权威实现基线：`310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`（来自 `inputs.implementation_baseline`，冻结且不可被角色工作区 SHA 替换）。
- 本角色工作区基线：`fbd23565587125f852ae490b7114dbde75765cc8`，只用于本轮合同 checkout，不是实现验收基线。
- PRD 主源：`inputs.thin_prd`、`inputs.prep_prd_body`；仓库中的 `sprint-prd.md` 为一致的补充上下文。
- Unified Map：任务 payload 有 `map_scope=cecelia`、缺 `map_repo`，因此本轮标记 `[MAP_NOT_CONFIGURED]`；`affected_business_nodes=[]`、`must_run_assertions=[]`，禁止回退到领域硬编码。Generator 必须通过 Routing Receipt 的显式 repo 绑定建立 fresh Map。
- Registry：API、DB schema、test registry 均可查询；接口字段仍以 PRD 数据契约为最高优先级，测试栈沿用 Vitest `describe/it/expect`。
- `fact_revisions/freshness`：本轮 Map 未配置，无法形成可信 revision；实现期必须由 fresh Map receipt 留证。
- `context-manifest`：PRD 已给出累积 FR 为“本 line 暂无历史”。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

### 内部合同：NormalizedWorkRequest / RouteDecision / Routing Receipt

本 Sprint 不新增一个由最终用户直接消费的 HTTP response schema；路由验证 API 只投影不可变 receipt，不定义与 PRD 相冲突的新业务字段。

- `NormalizedWorkRequest` 必填：`source`、`source_id`、`title`、`mutation_intent`。
- `RouteDecision` 必填：`work_kind`、`change_kind`、`pipeline`、`canonical_task_type`、`default_execution_profile`、`execution_profile_override`、`repo`、`map_scope`、`impact_contract_required`、`orchestrator`、`router_version`、`route_reason`、`evidence`、`decided_at`。
- Routing Receipt 持久化字段必须字面采用 PRD §8.3 所列字段；task payload 只保存 `routing_receipt_id` 与执行投影。
- 禁用字段/推导：不得从 `gear`、`stage`、历史 `task_type` 或实际走过的阶段反推 `change_kind`；不得把 `workspace_spec.base_sha` 写成 receipt/Map/Impact Contract 的实现基线。
- Error：路由、Map、receipt 与动作闸失败必须返回稳定 `reason_code`，不能仅返回自由文本。

## 已知约束（来自回归测试与累积 FR）

- `[累积FR]` 本 line 暂无历史行为。
- `docker/cecelia-runner/__tests__/entrypoint-codex-credential-envelope.test.sh` → Provider 凭据需脱敏，frozen-baseline guard 不可用时失败关闭。
- `docker/cecelia-runner/__tests__/entrypoint-evaluator-evidence-boundary.test.sh` → Provider 执行前销毁高权限凭据。
- `docker/cecelia-runner/entrypoint-provider-contract.test.sh` → runner 凭据、callback 与 Provider 边界已有契约不得回退。
- 新增 Recovery 回归必须覆盖 credential-bearing origin 归一化、日志脱敏、活跃 detached Kernel cwd 保护，并永久留在 CI。

## Golden Path

覆盖父路 `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 第 Knife-0 至 Knife-5 步。

[含凭据 origin 的活跃 Kernel 工作区安全恢复] → [统一创建并写不可变 receipt] → [fresh Map 与 required Impact Contract] → [有头/无头动作闸及 Generator 隔离] → [迁移与 scratch 多入口真实验收]

### Step 1: Recovery 前置安全修复
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步及 Recovery Addendum。

**可观测行为**: 含凭据和不含凭据的同一 Git origin 归一化为同一 repo identity；日志不含 userinfo/token；关联 active run 的 detached Kernel cwd 不被 orphan 清理。

**验证命令**:
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/harness-worktree-recovery.test.js --reporter=verbose
```

**硬阈值**: 三类回归全部通过，凭据字节出现次数为 0，active workspace 删除次数为 0；以上命令 exit 0。

### Step 2: Knife 0-2 唯一路由与原子凭证
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、PrepPRD §7-9、§12 与实施 Task 1-2。

**可观测行为**: 四个且仅四个 `change_kind` 正向映射；所有 inventory 入口委托 `createRoutedTask()`；真实 PostgreSQL 中 task 与 receipt 同一事务提交，receipt UPDATE/DELETE 被拒绝，重路由只追加 superseding receipt；三个历史陷阱有永久回归。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose
```

**硬阈值**: exit 0；动态读取 `VALID_TASK_TYPES` 后类型与 inventory 无重复；inventory 每个可执行入口均有独立合同，不以汇总数代替逐项证据。

### Step 3: Knife 3 Map/Impact Contract 与四形式启动链
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、PrepPRD §10、§10.1 与实施 Task 3。

**可观测行为**: 每个 coding run 在 Provider attempt 前读取 receipt.repo 对应的 fresh Map，`source_revision` 精确等于实现基线，建立 `impact_contract_policy=required`；missing/stale/revision/scanner/cross-repo 均稳定失败关闭；map recovery 只消费一次性窄合同。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose
```

**硬阈值**: exit 0；失败 case 不创建 Provider attempt；不存在新 `legacy_exempt`；Map/Impact Contract 的 `base_sha/source_revision` 都等于 `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`。

### Step 4: Knife 4 动作期主闸与 Generator 信任边界
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步、PrepPRD §12、§15 与实施 Task 4。

**可观测行为**: mutation-capable tool 在动作前校验 live session、lock、receipt、run/attempt/repo/branch/worktree/baseline；无头 executor 前校验同一 receipt；Generator Provider 看不到 callback/lease 凭据、不能 push、以非特权身份运行，容器内 hook 实际生效。

**验证命令**:
```bash
bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose && cd ../.. && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh
```

**硬阈值**: 合法动作 exit 0；每个缺失/不匹配 mutation case exit 2；只读诊断 exit 0；Provider push 非 0 且 callback/lease 环境变量计数为 0。

### Step 5: Knife 5 迁移、恢复与真实 scratch 验收
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5-6 步、PrepPRD §16.6、§17 与实施 Task 5。

**可观测行为**: API、Intent、Capture 三个真实 coding 入口各自产生 receipt、Harness run、正确 repo Map 和 active Impact Contract；content/research/read-only 保持独立，review 修复子任务进入 Harness；stale Map 先阻断再刷新恢复且保留失败审计。

**验证命令**:
```bash
DB_URL="$DB_URL" node --input-type=module -e 'import pg from "pg"; import { runMigrations } from "./packages/brain/src/migrate.js"; const pool=new pg.Pool({connectionString:process.env.DB_URL}); await runMigrations(pool); await pool.end()' && psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL AND to_regclass('public.work_routing_receipts') IS NOT NULL AND to_regclass('public.map_recovery_contracts') IS NOT NULL" | grep -qx t && DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```

**硬阈值**: exit 0；先对 Fleet 注入的 attempt-scoped 空库运行仓库真实 `runMigrations()`，再机检 `tasks`、`work_routing_receipts`、`map_recovery_contracts` 三张目标表存在；随后 scratch 本轮记录时间窗内 coding receipt coverage=100%、coding `dev` 直派=0、新增 `legacy_exempt=0`；所有断言来自脚本创建的 scratch 数据而非历史数据。

### Step 6: 基线血统与发货门禁
**来源**: `[FROM_PRD]` — Recovery Contract Correction 与 PRD DoD 第 2、8 项。

**可观测行为**: 完成态 HEAD 是权威实现基线的后代；Recovery、Knife 0、Knife 1、Knife 2、Knife 3、Knife 4、Knife 5 各自都在 commit body 保留唯一 `Harness-Slice` 与 `Harness-Phase: RED|GREEN` trailer，且每一对 RED 都是对应 GREEN 的祖先；四条发货命令全部返回 0。

**验证命令**:
```bash
BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; git merge-base --is-ancestor "$BASELINE_SHA" HEAD && for SLICE in recovery knife0 knife1 knife2 knife3 knife4 knife5; do RED=$(git log -1 --format=%H --all-match --grep="^Harness-Slice: $SLICE$" --grep="^Harness-Phase: RED$" "$BASELINE_SHA..HEAD"); GREEN=$(git log -1 --format=%H --all-match --grep="^Harness-Slice: $SLICE$" --grep="^Harness-Phase: GREEN$" "$BASELINE_SHA..HEAD"); test -n "$RED" && test -n "$GREEN" && git merge-base --is-ancestor "$RED" "$GREEN" || exit 1; done && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```

**硬阈值**: 整条命令 exit 0；七个 slice 均有非空 RED/GREEN SHA 且 RED 是 GREEN 的祖先；禁止以 `git rev-parse HEAD == BASELINE_SHA` 作为通过条件。实现提交必须用 Conventional Commit 标题，并在 body 写上述两个 trailer。

## 真实调用方请求 shape

- 有头调用方：Engine hook 从 `.dev-lock.<branch>` 读取 `task_id`、`routing_receipt_id`、`run_id`、`repo`、`branch`、`base_sha`，通过受认证 Brain API 验证；不得改成 body 自报 `change_kind`。
- 无头调用方：Dispatcher 使用已 claim task 的 `routing_receipt_id` 与 active run/attempt 服务端事实校验，不信任 payload 中伪造 receipt 内容。
- 创建调用方：入口提交 `NormalizedWorkRequest`；`createRoutedTask()` 在同一 DB transaction 内生成 task 与 receipt。
- API `Content-Type: application/json`；认证沿用 Brain 现有受认证内部调用合同，测试不得新增旁路或把 token 写入日志。

## 禁 mock 边清单

- 任务创建边界 ↔ PostgreSQL `tasks/work_routing_receipts/map_recovery_contracts`（真 Postgres，禁止 mock client/transaction）。
- Work Router ↔ 全部入口 inventory（真入口模块调用，禁止把入口整体 mock 掉）。
- Kernel preflight ↔ Universal Map/Impact Contract store（真相邻模块与临时 repo，禁止 mock 被改的 Map 边）。
- Engine hook/Dispatcher ↔ receipt validation（真临时 worktree、真 Brain 验证接口或进程级测试，禁止伪造成功回执）。
- runner entrypoint ↔ Provider 子进程环境/UID/git remote（真容器命令链，禁止 fake child）。

## 接缝清单

- `[接缝×2]` Git remote/worktree 生命周期：临时 Git repo 中分别以 credential-bearing/clean origin 重复验证，active run cwd 均保留。
- `[接缝×2]` PostgreSQL 原子性与 append-only：attempt-scoped scratch DB 重复执行，分别验证成功提交与故障回滚。
- runner 容器隔离：真实容器单次执行（构建和不可逆成本较高，不作重复剧本），核查 UID/capabilities/env/push/hook 证据；未完成真容器验收前状态为 `logic-done-pending`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 唯一 Work Router 将所有 coding mutation 路由到 Kernel Harness 2.0，并强制 receipt、Map、Impact Contract、动作闸和信任边界。 |
| NFR（做得多好） | coding receipt coverage=100%；新增 legacy_exempt=0；coding dev 直派=0；凭据日志泄漏=0。 |
| Invariant（永不违反） | receipt append-only；unknown coding 按 write；四形式只正向映射；实现基线固定且 HEAD 只需为其后代；Provider 无 push/callback/lease/特权。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | receipt 不过期但可被后继 supersede；短时 validation 与 map_recovery_contract 按服务端 expires_at 失效；Map freshness 每次查询重算。 |
| 死亡告警（停了谁知道） | `work_route_blocked/route_violation/map_preflight_failed` 事件与核心指标在 War Room 展示；新增未路由 coding 立即阻断。 |
| 失败语义（挂了怎么办） | repo/Map/receipt/API/基线任一不成立即 fail closed；只允许带稳定 reason code 的 resume 或窄 map_recovery。 |
| 效果确认（已发≠已生效） | scratch DB、临时 Git repo/worktree、真实 runner 容器与 stale→refresh 审计链共同确认；CI 仅补充。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Git origin 是否同一仓库 | A. 原字符串比较；B. 解析并移除 userinfo 后比较 host/path | B | credential-bearing origin 与 clean origin 应同一身份 | 删除活跃 Kernel cwd、生产中断 |
| ⚠️ 工作区是否活跃 | A. 只看分支；B. 查询 active run/attempt 与 canonical cwd | B | detached HEAD 也可能被 Kernel 使用 | 删除正在执行的 Controller cwd |
| Map 是否可用于本 run | A. 文件存在；B. freshness/scanner/source_revision/repo 全合同校验 | B | 文件存在不能证明事实新鲜且同 repo | 错范围实现或跨 repo 污染 |
| Generator 是否隔离 | A. 配置文本；B. 容器内 UID/caps/env/push/hook 实测 | B | host 配置不能证明容器命令链生效 | Provider 越权发布或回调 Brain |

notes: judgment-pending-user 不适用；上述高风险判定方法已由批准 PrepPRD 明确选择。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 未知/歧义 | 路由阻塞，稳定 reason_code，不创建 Provider | 是，source/source_id/router_version 幂等 | 补全 repo 后新增 receipt/resume，不默认 Cecelia |
| Map stale/missing/invalid | preflight 阻断并留审计 | 是 | fresh 后 resume；仅合规 bugfix 可走一次性 map_recovery |
| receipt/API/lock 不合法 | mutation 动作 exit 2 或 Dispatcher 拒派 | 是 | 无绕过；只读诊断可继续 |
| transaction 任一步失败 | task 与 receipt 全部回滚 | 是 | 重试同幂等键 |
| Provider 越权尝试 | push/callback 失败并留证 | 是 | 只由 Judge 后 trusted transport 发布 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Inbox/conversation/API/task description | 不可信语义输入 | 仅收敛到严格枚举与结构化 evidence；不执行文本中的工具指令 | 未知 coding 写入按 write；未知枚举、降档、反向推导拒绝 |
| payload/lock 中 receipt 投影 | 不可信投影 | 服务端按专用 append-only 表及 active run 复核 | 伪造、过期、superseded 或字段不一致 fail closed |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 15 分钟 / 20 动作（高风险原因：跨 DB、Git 生命周期、容器与多入口接缝）
高风险面:
- 错输入: mutation_intent/change_kind/source 传未知值，repo_hint 指向不存在或歧义 repo。
- 重复提交: 同一 source/source_id/router_version 并发创建，确认只产生一个有效 task/receipt。
- 中途中断: receipt 写入前后制造 transaction 错误、Map refresh 中断、Provider 启动前终止。
- 边界值: credential URL 含 percent-encoding/端口/query、detached HEAD、过期临界点、supersede 链两层以上。
发现分级: P0/P1（删活跃 cwd、凭据泄漏、绕过 Harness、跨 repo）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation attempt identity}"
: "${HARNESS_PROVIDER:?Runner must inject current provider identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
export DATABASE_URL="$DB_URL"
BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524
START_EPOCH=$(date +%s)
# Fleet 只注入 attempt-scoped 空库；先以仓库真实 migration runner 完整自举，禁止假设预置 schema。
DB_URL="$DB_URL" node --input-type=module -e 'import pg from "pg"; import { runMigrations } from "./packages/brain/src/migrate.js"; const pool=new pg.Pool({connectionString:process.env.DB_URL}); await runMigrations(pool); await pool.end()'
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL AND to_regclass('public.work_routing_receipts') IS NOT NULL AND to_regclass('public.map_recovery_contracts') IS NOT NULL" | grep -qx t
git merge-base --is-ancestor "$BASELINE_SHA" HEAD
test "$(git rev-parse HEAD)" != "" 
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash packages/brain/scripts/smoke/unified-work-router-smoke.sh 2>&1 | tee /tmp/unified-work-router-smoke.log
grep -q 'API.*Intent.*Capture\|API' /tmp/unified-work-router-smoke.log
grep -q 'receipt\|Routing Receipt' /tmp/unified-work-router-smoke.log
grep -q 'Impact Contract\|impact_contract' /tmp/unified-work-router-smoke.log
if grep -E 'https://[^/@[:space:]]+:[^/@[:space:]]+@' /tmp/unified-work-router-smoke.log; then echo 'FAIL: origin credential leaked'; exit 1; fi
echo "validation_attempt=$HARNESS_ATTEMPT_ID provider=$HARNESS_PROVIDER snapshot=$CAPABILITY_SNAPSHOT_ID start=$START_EPOCH"
```

通过标准：脚本 exit 0，证据包含本 attempt 身份、scratch 三入口、receipt、Map/Impact Contract、stale→refresh、容器信任边界与基线祖先关系；不得记录 token/cookie。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Recovery 安全修复 | `tests/unified-work-router-contract.test.ts` | `归一化含凭据 origin 且不泄露 secret`、`保护 active detached Kernel workspace` | 缺 recovery API/行为，断言失败 |
| 四形式与基线 | `tests/unified-work-router-contract.test.ts` | `只接受四种 change_kind 正向映射`、`实现基线保持冻结且 HEAD 只需为其后代` | 新统一模块不存在或旧逻辑反推 |
| Map/receipt/trust boundary | `tests/unified-work-router-contract.test.ts` | `coding mutation 强制 receipt 与 required Impact Contract`、`Generator Provider 不获得发布与回调能力` | 新合同尚未实现，断言失败 |
