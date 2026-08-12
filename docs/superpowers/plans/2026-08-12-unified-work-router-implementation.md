# Unified Work Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有有头、无头 coding mutation 在动作前经唯一 Work Router 进入 Kernel Harness 2.0，并强制消费 fresh Universal Map、Impact Contract 与四形式执行合同。

**Architecture:** 以纯函数路由核心和事务级 `createRoutedTask()` 收敛任务创建，以不可变 Routing Receipt 保存决策；有头由 Engine PreToolUse、无头由 Dispatcher 在动作期验证同一 receipt。Kernel 按 `change_kind` 正向选择四档默认 profile，并把 Map/Impact Contract、frozen baseline 和 Generator trust boundary 变成强制 Gate。

**Tech Stack:** Node.js ESM、Express、PostgreSQL migrations、Vitest、Bash hooks、Docker runner、Universal Map API。

---

## 文件结构

- Create `packages/brain/src/work-router.js`：纯函数 normalize/classify/repo/profile 决策。
- Create `packages/brain/src/work-routing-store.js`：事务级 task + receipt 原子写入。
- Create `packages/brain/src/routes/work-routing.js`：receipt 查询与动作期验证 API。
- Create `packages/brain/migrations/411_work_routing_receipts.sql`：不可变 receipt 与恢复合同。
- Modify `packages/brain/src/routes/task-tasks.js`：公开创建入口委托统一边界。
- Modify 直接任务创建入口：逐项消除业务路径 `INSERT INTO tasks`。
- Modify `packages/brain/src/orchestrator/kernel-run-store.js`、`derive.js`、`dispatcher.js`：四形式、Map preflight、动作闸和 L2 强制。
- Modify `packages/engine/hooks/dev-mode-tool-guard.sh`、`packages/engine/skills/dev/scripts/worktree-manage.sh`：有头 receipt 绑定。
- Modify `docker/cecelia-runner/entrypoint.sh`：Generator frozen baseline 与 trust boundary。
- Create `packages/brain/scripts/smoke/unified-work-router-smoke.sh`：scratch 多入口真实验收。

### Task 1: Knife 0–1 路由合同、迁移与统一创建边界

**Files:**
- Create: `packages/brain/src/work-router.js`
- Create: `packages/brain/src/work-routing-store.js`
- Create: `packages/brain/src/routes/work-routing.js`
- Create: `packages/brain/migrations/411_work_routing_receipts.sql`
- Modify: `packages/brain/src/routes/task-tasks.js`
- Modify: `packages/brain/server.js`
- Test: `packages/brain/src/__tests__/work-router.test.js`
- Test: `packages/brain/src/__tests__/work-routing-entry.test.js`
- Test: `packages/brain/src/__tests__/migration-411-work-routing.test.js`
- Test: `packages/brain/src/__tests__/integration/work-routing-store.integration.test.js`

- [ ] **Step 1: 提交 RED 合同**

先写四形式、unknown coding fail-safe、repo 歧义、正向 profile 和原子 receipt 测试。核心断言固定为：

```js
expect(selectPipeline({ work_kind: 'coding_mutation', change_kind: 'new_capability' }))
  .toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: 'new-capability-v1' });
expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' }))
  .toThrow('change_kind_required');
```

运行：

```bash
cd packages/brain
npx vitest run src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js
```

期望：模块、表和统一边界不存在而失败。提交 `test(brain): define unified work routing contracts`。

- [ ] **Step 2: 建立不可变数据合同**

Migration 411 创建：

```sql
CREATE TABLE work_routing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  source text NOT NULL, source_id text NOT NULL,
  work_kind text NOT NULL, change_kind text,
  pipeline text NOT NULL, canonical_task_type text NOT NULL,
  default_execution_profile text, execution_profile_override text,
  repo text, map_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_contract_required boolean NOT NULL DEFAULT false,
  orchestrator text NOT NULL, router_version text NOT NULL,
  route_reason text NOT NULL, evidence jsonb NOT NULL,
  supersedes_receipt_id uuid REFERENCES work_routing_receipts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

同一 migration 创建 append-only UPDATE/DELETE 拒绝 trigger，以及单次消费的 `map_recovery_contracts`，字段绑定 receipt/task/repo/branch/base_sha/reason_code/expires_at/authorization_evidence/attempt_id。

- [ ] **Step 3: 实现纯函数路由器**

导出稳定接口：

```js
export const CHANGE_KINDS = Object.freeze(['new_capability', 'capability_change', 'bugfix', 'parameter_only']);
export function normalizeWorkRequest(input) {}
export function classifyWork(request) {}
export function resolveRepo(request, repositoryFacts) {}
export function selectPipeline({ work_kind, change_kind, execution_profile_override }) {}
export function routeWork(input, facts) {}
```

override 只能增加阶段/人工审核；任何从 gear/stage/task_type 反推 `change_kind` 的输入都拒绝。

- [ ] **Step 4: 实现事务级创建与路由 API**

`createRoutedTask(client, normalizedRequest)` 必须在一个 transaction 内 INSERT task、INSERT receipt，task payload 只保存 `routing_receipt_id` 投影；任一步失败整体回滚。`POST /tasks` 只负责构造 NormalizedWorkRequest 并调用该函数。

- [ ] **Step 5: GREEN、真实 DB 与提交**

只连接 `cecelia_test|*_scratch`，验证 task/receipt 同生同灭、receipt UPDATE/DELETE 被拒绝、同 source/source_id/router_version 幂等。运行 Task 1 全部测试，提交 `feat(brain): add transactional unified work router`。

### Task 2: Knife 0–2 全入口收敛与既有三陷阱

**Files:**
- Create: `packages/brain/src/task-creation-inventory.js`
- Modify: `packages/brain/src/planner.js`
- Modify: `packages/brain/src/proposal.js`
- Modify: `packages/brain/src/routes/capture-atoms.js`
- Modify: `packages/brain/src/actions.js`
- Modify: `packages/brain/src/intent.js`
- Modify: inventory 中其余业务任务创建文件
- Test: `packages/brain/src/__tests__/task-creation-inventory.test.js`
- Test: `packages/brain/src/__tests__/work-router-entrypoints.test.js`
- Test: `packages/brain/src/routes/__tests__/capture-atoms-routing.test.js`

- [ ] **Step 1: 冻结 70 类型与 33 入口 RED 基线**

测试从 `VALID_TASK_TYPES` 动态断言 70/unique=70；inventory 每项包含 `module`、`source`、`creates_executable_task`、`migration_status`，并扫描禁止业务模块新增裸 `INSERT INTO tasks`。

- [ ] **Step 2: 永久复现三个既有缺陷**

断言 Planner 创建 task 必有 `task_type`；Proposal 不得把 `change.skill` 写入 `task_type`；capture decision 只写 `category/topic/decision/reason/status` 等真实 decisions schema 列。提交 `test(brain): expose legacy task creation routing defects`。

- [ ] **Step 3: 收敛入口**

所有可执行业务任务改为调用 `createRoutedTask()`；capture-triage 与 Thalamus 只输出分类 evidence，最终 work kind 由 Work Router 一次决定。数据库迁移/恢复路径以显式静态 allowlist 保留，且不能创建 Dispatcher 可执行任务。

- [ ] **Step 4: GREEN 与提交**

运行 inventory、Planner、Proposal、Capture、Intent、Actions 受影响测试；检查 coding 全为 `harness_initiative`、content/research 保持原 Pipeline。提交 `refactor(brain): route all executable task creation through one boundary`。

### Task 3: Knife 3 四形式、Map preflight、Impact Contract 与 bootstrap

**Files:**
- Modify: `packages/brain/src/impact-contract/change-kind.js`
- Modify: `packages/brain/src/orchestrator/kernel-run-store.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Create: `packages/brain/src/orchestrator/preflight/map-impact-contract.js`
- Modify: `packages/brain/src/orchestrator/preflight/requirements.js`
- Test: `packages/brain/src/orchestrator/__tests__/change-kind-profiles.test.js`
- Test: `packages/brain/src/orchestrator/preflight/map-impact-contract.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/map-recovery-contract.test.js`

- [ ] **Step 1: RED 四档状态机**

逐档断言：new capability 跑 Planner+GAN+Generate+Evaluate+Judge+human；capability change 跑轻 Planner、无 GAN、其余相同并 human；bugfix/parameter only 无 Planner/GAN但保留 Generate+Evaluate+Judge且无人审。反向推导和降档必须失败。

- [ ] **Step 2: RED Map/Impact 合同**

覆盖 fresh/missing/stale/revision mismatch/scanner invalid/repo cross-contamination；断言 `kernel-run-store.js` 对所有新 coding run 写 `impact_contract_policy='required'`，不再从 payload opt-in 得出 `legacy_exempt`。

- [ ] **Step 3: 实现强制 preflight**

在首次计划/生成动作前查询与 receipt.repo 相同的 Map header，校验 freshness、source revision 与 baseline，生成 active Impact Contract；失败返回稳定 reason code 且不创建 Provider attempt。

- [ ] **Step 4: 实现 bootstrap 最小恢复合同**

只允许 `bugfix` 和三种故障 reason code；对冻结 allowlist 做 Structure/Diff 双检查；正常 Map、过期合同、复用 attempt、业务 capability diff 全拒绝。恢复后四 scanner 同 revision、Map fresh 才能 terminal success。

- [ ] **Step 5: GREEN 与提交**

运行 derive、preflight、kernel run-store 和 Impact Contract 测试，提交 `feat(brain): enforce map governed four-form harness runs`。

### Task 4: Knife 4 有头动作闸与 Generator L2 信任边界

**Files:**
- Modify: `packages/engine/hooks/dev-mode-tool-guard.sh`
- Modify: `packages/engine/skills/dev/scripts/worktree-manage.sh`
- Modify: `packages/brain/src/routes/work-routing.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Test: `packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher-routing-receipt.test.js`
- Test: `docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh`

- [ ] **Step 1: RED 有头 Gate**

用真实临时 Git worktree 覆盖无 light、无 lock、缺字段、receipt 404/expired/superseded、Brain 不可达、repo/branch/base SHA 不匹配；mutation-capable tool 均 exit 2，只读诊断 exit 0。

- [ ] **Step 2: lock 与验证 API**

`.dev-lock.<branch>` 写入 `task_id/routing_receipt_id/run_id/repo/branch/base_sha`。验证端点原子读取 receipt、active run/attempt 并返回签名后的短时 validation result；hook 不缓存过期成功结果。

- [ ] **Step 3: RED/GREEN 无头 Dispatcher Gate**

executor 调用前验证同一 receipt；缺失/不一致记录 `route_violation` 并拒绝派发，不修改 payload 自救。

- [ ] **Step 4: RED/GREEN Generator 隔离**

所有 Generator run 无条件武装 frozen-baseline pre-push 与退出 assertion；Provider 环境注入 blocked pushurl，经 `setpriv` 清空 capabilities，并 `env -u BRAIN_URL -u HARNESS_CALLBACK_URL -u HARNESS_CALLBACK_TOKEN -u HARNESS_LEASE_OWNER -u HARNESS_LEASE_GENERATION`。容器内实际 hook path 必须存在；批准 ref 只由受信任 transport 发布。

- [ ] **Step 5: 提交**

运行三个精确测试组、ShellCheck 与容器 entrypoint 合同测试，提交 `feat(harness): gate headed and headless coding at action time`。

### Task 5: Knife 5 迁移、可观测性与真实验收

**Files:**
- Create: `packages/brain/scripts/smoke/unified-work-router-smoke.sh`
- Modify: `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`
- Create: `apps/dashboard/src/pages/warroom/WarRoomPage.test.tsx`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Test: `packages/brain/src/__tests__/work-routing-observability.test.js`

- [ ] **Step 1: RED scratch smoke**

在 `cecelia_scratch` 从 API、Intent、Capture 各建 coding；断言三项都有 receipt、Harness run、正确 repo Map、active Impact Contract。再建 content/research/read-only 对照并断言不误入 Harness。

- [ ] **Step 2: stale/resume 与 bootstrap 实弹**

把唯一 smoke repo header 调成 16 分钟旧，证明普通 coding 不进入 Provider；刷新四 scanner 后 resume 且保留失败审计。另制造 scanner 故障，证明只有 allowlist 内 map recovery 成功并在全量重扫 fresh 后关单。

- [ ] **Step 3: 有头/无头与真实容器实弹**

有头合法 receipt 允许一次受控写入，缺 receipt 写入被 hook 阻断；无头合法任务进入 Generator，容器内验证 callback token 不可见、Provider push 失败、trusted transport 在 Judge 后发布。

- [ ] **Step 4: 版本与 DevGate**

更新 Brain patch version 和 DEFINITION。依次运行：

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```

- [ ] **Step 5: 全量验证、提交与 Harness 收口**

运行受影响 Vitest、Engine hook tests、runner shell tests、`git diff --check` 和 light evaluator；确认 production 只读观测中新 `legacy_exempt=0`、coding receipt coverage=100%。提交 `feat(cecelia): enforce unified work routing across all coding`，交由独立 Evaluator/Judge，CI 全绿后 merge fence 收口。
