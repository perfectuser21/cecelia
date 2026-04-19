# Harness v2 M1 数据模型迁移 — Design Spec

Status: APPROVED (Research Subagent, autonomous /dev)
Owner: Alex
Created: 2026-04-19
Relates to: `docs/design/harness-v2-prd.md` §4 · `packages/brain/migrations/232_add_harness_generator_task_type.sql`

---

## 1. 目标

实现 Harness v2 PRD §4 的数据模型变更（只动 schema + 代码常量，不动业务逻辑）：

1. 新增 3 张表：`initiative_contracts` / `task_dependencies` / `initiative_runs`
2. 扩展 `tasks.task_type` CHECK 约束，加 `harness_initiative` / `harness_task` / `harness_final_e2e` 三个新类型（保留所有 v1 老类型）
3. 同步 `packages/brain/src/task-router.js`（VALID_TASK_TYPES / SKILL_WHITELIST / LOCATION_MAP / TASK_REQUIREMENTS）
4. 同步 `packages/brain/src/pre-flight-check.js`（SYSTEM_TASK_TYPES）
5. 写 integration test 验证 schema 生效

## 2. 范围边界

**做**：
- 4 个 migration 文件 + 2 个代码常量文件 + 1 个 test 文件

**不做**：
- 不改 `harness-graph.js` / `harness-graph-runner.js` / `executor.js`（M2-M5 的事）
- 不改任何 `SKILL.md`（后续 milestone）
- 不删 v1 老 task_type（向后兼容保留）
- 不加 FK 到 `projects` 表（PRD §4.2 写了 FK，但本任务明确放弃 —— projects 表不一定对每个 initiative_id 都有记录）

## 3. Migration 编号

现有最大 `235`，本任务使用 `236-239`：

| # | 文件 | 内容 |
|---|------|------|
| 236 | `236_harness_v2_initiative_contracts.sql` | 建 `initiative_contracts` 表 |
| 237 | `237_harness_v2_task_dependencies.sql` | 建 `task_dependencies` 表 |
| 238 | `238_harness_v2_initiative_runs.sql` | 建 `initiative_runs` 表（引用 initiative_contracts.id） |
| 239 | `239_harness_v2_task_types.sql` | 扩展 `tasks_task_type_check` 约束 |

**重要**：migration runner 按文件名排序依次应用（见 `migrate.js` L50），因此 238 在 236 之后应用，`REFERENCES initiative_contracts(id)` 安全。

## 4. Schema 设计

### 4.1 initiative_contracts（migration 236）

```sql
CREATE TABLE IF NOT EXISTS initiative_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,               -- 不加 FK
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','superseded')),
  prd_content TEXT,
  contract_content TEXT,
  e2e_acceptance JSONB,
  budget_cap_usd NUMERIC(8,2) DEFAULT 10,
  timeout_sec INT DEFAULT 21600,             -- 6h
  review_rounds INT DEFAULT 0,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (initiative_id, version)
);
CREATE INDEX IF NOT EXISTS idx_initiative_contracts_initiative
  ON initiative_contracts(initiative_id, status);
```

### 4.2 task_dependencies（migration 237）

```sql
CREATE TABLE IF NOT EXISTS task_dependencies (
  from_task_id UUID NOT NULL,
  to_task_id UUID NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'hard'
    CHECK (edge_type IN ('hard','soft')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_task_id, to_task_id),
  CHECK (from_task_id != to_task_id)          -- 防自环
);
CREATE INDEX IF NOT EXISTS idx_task_deps_from ON task_dependencies(from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_to   ON task_dependencies(to_task_id);
```

注：完整 DAG 循环检查（A→B→A 两跳）由 runtime 递归 CTE 处理，不在本 milestone 内。

### 4.3 initiative_runs（migration 238）

```sql
CREATE TABLE IF NOT EXISTS initiative_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,
  contract_id UUID REFERENCES initiative_contracts(id),
  phase TEXT NOT NULL DEFAULT 'A_contract'
    CHECK (phase IN ('A_contract','B_task_loop','C_final_e2e','done','failed')),
  current_task_id UUID,
  merged_task_ids UUID[] DEFAULT ARRAY[]::UUID[],
  cost_usd NUMERIC(8,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  deadline_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_initiative_runs_initiative ON initiative_runs(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_runs_phase      ON initiative_runs(phase);
```

### 4.4 task_type 扩展（migration 239）

DROP + 重建 `tasks_task_type_check` 约束，在 `232` 既有列表基础上追加 3 个新类型：
- `harness_initiative`
- `harness_task`
- `harness_final_e2e`

其他类型 **全部保留**（v1 兼容）。

## 5. 代码常量同步

### 5.1 `packages/brain/src/task-router.js`

四处改动：
- `VALID_TASK_TYPES` 加 3 个新类型
- `SKILL_WHITELIST`：
  - `harness_initiative` → `/harness-planner`（M1 复用，M2 重写）
  - `harness_task` → `/_internal`（tick 内部状态机，不派 agent）
  - `harness_final_e2e` → `/harness-evaluator`（M1 复用，M5 重写）
- `LOCATION_MAP`：三者均 `'us'`
- `TASK_REQUIREMENTS`：三者均 `['has_git']`

### 5.2 `packages/brain/src/pre-flight-check.js`

`SYSTEM_TASK_TYPES` 数组追加 `harness_initiative`、`harness_task`、`harness_final_e2e`（这些任务 auto-generated，不需要 PRD）。

## 6. 测试策略

**文件**：`packages/brain/src/__tests__/harness-v2-schema.integration.test.js`

用 vitest + `db.js` 的 default pool（沿用现有 integration test 模式，例如 `migration-041.test.js`）。

**测试用例**：

1. **表存在**：`information_schema.tables` 查 3 张新表均存在
2. **列类型正确**：`information_schema.columns` 验证关键字段
   - `initiative_contracts.budget_cap_usd` = numeric
   - `initiative_runs.merged_task_ids` = ARRAY / `_uuid`
3. **status CHECK**：插入 `status='invalid'` 应抛错
4. **phase CHECK**：插入 `phase='invalid'` 应抛错
5. **自环 CHECK**：`task_dependencies` 同 from/to 插入应抛错
6. **edge_type CHECK**：插入 `edge_type='maybe'` 应抛错
7. **UNIQUE(initiative_id, version)**：重复 initiative_id+version 应抛错
8. **tasks.task_type 新类型接受**：三个新类型各 INSERT 成功，ROLLBACK
9. **tasks.task_type 老类型仍然接受**：`dev`、`harness_planner` 等仍 INSERT 成功（兼容性回归）

所有"应抛错"断言用 `await expect(pool.query(...)).rejects.toThrow(...)` 或 try/catch + expect。

所有 test INSERT 都包在 transaction 里 ROLLBACK，不污染 DB。

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 本地 DB 已有旧版试验表 | 用 `CREATE TABLE IF NOT EXISTS`，幂等 |
| migration 236-238 顺序错了导致 FK 失败 | 文件名按数字排序，migrate.js 按 `readdirSync + sort()` 有保证 |
| task_type 扩展漏掉老类型 | 严格复制 232 的 array，只 append |
| vitest 并发跑 test 污染共享 DB | 用 savepoint + rollback 包裹 INSERT；每个 test 用唯一 UUID |

## 8. DoD

- [ARTIFACT] 4 个 migration 文件存在
  Test: `manual:node -e "['236_harness_v2_initiative_contracts','237_harness_v2_task_dependencies','238_harness_v2_initiative_runs','239_harness_v2_task_types'].forEach(f=>require('fs').accessSync('packages/brain/migrations/'+f+'.sql'))"`
- [BEHAVIOR] 三张新表存在且关键列类型正确
  Test: tests/packages/brain/src/__tests__/harness-v2-schema.integration.test.js
- [BEHAVIOR] task_type CHECK 接受 harness_initiative/harness_task/harness_final_e2e
  Test: tests/packages/brain/src/__tests__/harness-v2-schema.integration.test.js
- [BEHAVIOR] task-router.js VALID_TASK_TYPES 含三个新类型
  Test: `manual:node -e "const {VALID_TASK_TYPES}=await import('./packages/brain/src/task-router.js');['harness_initiative','harness_task','harness_final_e2e'].forEach(t=>{if(!VALID_TASK_TYPES.includes(t))process.exit(1)})"`
- [BEHAVIOR] pre-flight-check.js SYSTEM_TASK_TYPES 含三个新类型
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');['harness_initiative','harness_task','harness_final_e2e'].forEach(t=>{if(!c.includes(\"'\"+t+\"'\"))process.exit(1)})"`

## 成功标准

- 在全新 Cecelia DB 上运行 `node packages/brain/src/migrate.js` → 4 个 migration 依次成功应用
- `npx vitest run packages/brain/src/__tests__/harness-v2-schema.integration.test.js` 全部 PASS
- `POST localhost:5221/api/brain/tasks` with `task_type=harness_initiative` 路由成功（SKILL_WHITELIST 能 resolve，不报 "invalid_task_type"）
