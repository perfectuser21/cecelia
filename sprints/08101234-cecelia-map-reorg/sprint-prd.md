# Sprint PRD：Cecelia 承诺地图归位

**Sprint ID**: 08101234-cecelia-map-reorg
**Task ID**: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
**分支**: cp-08101944-ws-f491a8dd
**日期**: 2026-08-10
**决策依据**: decisions.id = 4bc109e9-3b70-4b17-a1b4-bcd01bfae776

---

## 不变量（Invariants）

1. **分支锁**：所有代码改动仅限当前分支 `cp-08101944-ws-f491a8dd`，禁止直推 main
2. **迁移文件唯一入口**：任何 DB schema 或数据变更必须走 `packages/brain/migrations/NNN_*.sql` migration 文件，禁止手工 psql ALTER
3. **anchor 引用完整性**：迁移后 4 条 in_progress 任务的 `payload.anchor.journey_id` 必须仍能解析为有效 journey 行（不因改 UUID 或删行导致锚断裂）；anchor-check.js 中 `journey_id / gp_id / step_id` 三字段校验不能失效
4. **journey_features FK 语义**：`journey_features.journey_id` 字段是 `ON DELETE SET NULL`——物理删除任何 journey 行会让现有挂片变孤儿；因此迁移中所有 journey 调整只能用 `status = 'deprecated'` 或数据 UPDATE，禁止物理 DELETE
5. **journey_type 枚举锁**：journeys 表当前 CHECK 约束 `journey_type IN ('user_facing','autonomous','dev_pipeline','agent_remote')`；新建行必须使用此枚举值，不得扩展枚举（除非 migration 先 ALTER CHECK 约束）
6. **幂等性**：所有 SQL 使用 `ON CONFLICT DO NOTHING / DO UPDATE` + `IF NOT EXISTS`，migration 可重复执行不报错
7. **CI 守门**：push 后必须等待 `brain-ci.yml` 全绿，禁止 `gh pr merge --admin` 绕过

---

## 功能需求（FR）

### FR-1：Capability 一等实体化——自引用方案落库

**方案选择**（先于代码的架构决策）：

当前 journeys 表无 `parent_journey_id` 字段，golden_paths（capabilities_registry 视图）是提案审批流水表，两者均不能回答"Cecelia 现在有几个 Capability"。

**采纳方案：journeys 表自引用（`parent_journey_id`）**，而不是新建 capabilities 表，理由：
- journey_features、journey_steps 的 FK 全指向 journeys.id，自引用零影响
- 391 迁移已将 journeys 注释为 "价值流 Value Stream"，父行=价值流，子行=Capability，语义自洽
- 不需要新 FK 级联逻辑，仅需 `REFERENCES journeys(id) ON DELETE SET NULL`

**Migration 397**（schema）：
```sql
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS parent_journey_id UUID
    REFERENCES journeys(id) ON DELETE SET NULL;
ADD COLUMN IF NOT EXISTS capability_code TEXT; -- F0/F1/.../G1/G5 等短码，唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_capability_code
  ON journeys(capability_code) WHERE capability_code IS NOT NULL;
```

### FR-2：2 条价值流行创建

**Migration 398**（数据）：

新建工厂线和管家线两条价值流顶层行（`parent_journey_id = NULL`，`journey_type = 'dev_pipeline'`，`biz_area = 'cecelia'`，`status = 'active'`）：

| capability_code | name | UUID（新建） |
|---|---|---|
| VS_FACTORY | 工厂（Factory）价值流 | 由 gen_random_uuid() |
| VS_STEWARD | 管家（Steward）价值流 | 由 gen_random_uuid() |

### FR-3：11 个 Capability 行归位

将现有 F0–F7/MJ5 的 active journey 行降级为工厂线子 Capability，将 G1–G5 新建或改造为管家线子 Capability：

| 目标 code | 对应现行 journey（name/存量行） | 归属价值流 | 操作 |
|---|---|---|---|
| F0 | 工厂·F0 提案打磨 | VS_FACTORY | UPDATE parent_journey_id + capability_code |
| F1 | 工厂·F1 开发闭环（id: e6f803f2-...） | VS_FACTORY | UPDATE |
| F2 | 工厂·F2 部署闭环 | VS_FACTORY | UPDATE |
| F3 | 工厂·F3 夜间体检 | VS_FACTORY | UPDATE |
| F4 | 工厂·F4 故障自愈 | VS_FACTORY | UPDATE |
| MJ5 | MJ5 承诺地图 | VS_FACTORY | UPDATE |
| G1 | 原 F5 指挥舱（id: 8bb8252f-...） | VS_STEWARD | UPDATE + 改 capability_code |
| G2 | 原 F6 收件箱 | VS_STEWARD | UPDATE + 改 capability_code |
| G3 | 晨报感知（新立） | VS_STEWARD | INSERT |
| G4 | 原 F7 记忆知识 | VS_STEWARD | UPDATE + 改 capability_code |
| G5 | 战略 OKR（新立） | VS_STEWARD | INSERT |

西安机群 infrastructure 独立区：`UPDATE journeys SET status = 'deprecated' WHERE biz_area = 'infrastructure'`（不物理删除），同时在横切件池中以 F8 登记（见 FR-6）。

### FR-4：F1 挂片人工可核查分拣（不批量脚本）

F1（开发闭环）下挂有 ~46 个 journey_features 行，其中约 10 个实为 ZenithJoy 业务线挂片。

**分拣规则**（AI 可跑 SQL 核查，但不自动迁移）：

1. 先执行只读 SQL 列出候选：
   ```sql
   SELECT id, name, "group", status FROM journey_features
   WHERE journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'
   ORDER BY "group", name;
   ```
2. 判断标准：name/group 中含 "智能客服/ZenithJoy/客户/Line04/content-pipeline" 关键词的视为 ZenithJoy 挂片
3. 确认清单后，执行 `UPDATE journey_features SET journey_id = '<zenithjoy_journey_id>' WHERE id IN (...)` 迁移
4. **禁止物理 DELETE**；migration 文件记录分拣 SQL + 候选清单注释

### FR-5：孤儿挂片归位（journey_id = NULL 的 23 行 + MJ1/[v1] 滞留 11 行）

**Migration 399**（数据清洗）：

- 23 行 `journey_id = NULL`：走 `UPDATE journey_features SET status = 'deprecated', updated_at = NOW() WHERE journey_id IS NULL`（正式 retire，不物理删除）
- MJ1/[v1] 系列退役 journey 下的 11 行：先确认对应 journey 的 status，将挂片迁至最近亲 active Capability 或 `UPDATE status = 'deprecated'` 留档

### FR-6：横切件池 7 项登记

7 项横切件当前无权威登记，最小化方案：利用 `journey_features` 表，以 `kind = 'enabler'`、`journey_id` 指向其主管 Capability 行登记。

| 横切件 | 主管 Capability | kind |
|---|---|---|
| 心跳传送带 | F1 | enabler |
| 凭据链 | F1 | enabler |
| 执行资源池（F8，原西安机群） | F1 | enabler |
| skill 分发链 | F1 | enabler |
| 告警链 | F4 | enabler |
| 数据库 | F1 | enabler |
| 网络 | F1 | enabler |

**Migration 400**（数据）：批量 `INSERT INTO journey_features` 7 条 enabler 行，幂等（`ON CONFLICT (id) DO NOTHING`）。

### FR-7：查询验收断言实现

提供可执行的验收查询，纳入 e2e/smoke 或 migration 注释：

```sql
-- 验收1：2条active价值流
SELECT COUNT(*) FROM journeys
WHERE parent_journey_id IS NULL AND status = 'active' AND biz_area = 'cecelia';
-- 期望：2

-- 验收2：工厂6个Capability
SELECT COUNT(*) FROM journeys
WHERE parent_journey_id = (SELECT id FROM journeys WHERE capability_code = 'VS_FACTORY')
  AND status = 'active';
-- 期望：6

-- 验收3：管家5个Capability
SELECT COUNT(*) FROM journeys
WHERE parent_journey_id = (SELECT id FROM journeys WHERE capability_code = 'VS_STEWARD')
  AND status = 'active';
-- 期望：5

-- 验收4：孤儿归零
SELECT COUNT(*) FROM journey_features WHERE journey_id IS NULL AND status != 'deprecated';
-- 期望：0

-- 验收5：横切件登记
SELECT COUNT(*) FROM journey_features WHERE kind = 'enabler' AND status != 'deprecated';
-- 期望：>= 7
```

---

## 非功能需求（NFR）

### NFR-1：锚点兼容性

迁移前 4 条 in_progress 任务（d33c81ab / 9b3a2609 / 61f7a4dd / f491a8dd）的 `payload.anchor.journey_id` 在迁移后仍能在 journeys 表中找到对应行（SELECT 1 FROM journeys WHERE id = anchor.journey_id 返回 1）。

**守卫**：migration 文件执行前运行以下 SQL 检查，任何被改 journey 的 id 必须保持不变：
```sql
-- 确认被更改的journey行id未变更
SELECT id FROM journeys WHERE id IN (
  'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', -- F1
  '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'  -- F5/G1
);
-- 两行必须返回
```

### NFR-2：迁移幂等性

所有 migration 文件在同一数据库重复执行不报错。使用 `ON CONFLICT DO NOTHING`、`IF NOT EXISTS`、`WHERE NOT EXISTS`。

### NFR-3：无 schema 破坏性变更

`ALTER TABLE` 仅 `ADD COLUMN IF NOT EXISTS`，不修改已有列类型、不 DROP 列、不 RENAME 存量列。

### NFR-4：CI 全绿

`brain-ci.yml` 全部 check 通过后方可合并，禁绕过。

---

## 实施路线（顺序）

```
Step 1: 分拣 F1 挂片（只读核查 SQL，人工确认清单）
Step 2: 写 Migration 397（schema: parent_journey_id + capability_code）
Step 3: 写 Migration 398（数据: 2条价值流顶层行 + 11个Capability归位）
Step 4: 写 Migration 399（数据: 孤儿归位/retire）
Step 5: 写 Migration 400（数据: 7项横切件登记）
Step 6: 补写验收查询测试
Step 7: CI 通过后 PR → main
```

---

## 技术约束汇总（来自代码实测）

| 约束点 | 来源 | 影响 |
|---|---|---|
| journey_type CHECK IN ('user_facing','autonomous','dev_pipeline','agent_remote') | migration 282 | 新建价值流/Capability 行必须用此枚举 |
| journey_features.journey_id ON DELETE SET NULL | migration 282 | 不能物理删 journey 行 |
| anchor-check.js: anchor.journey_id 必须存在 | src/anchor-check.js:95 | journey UUID 不能变更 |
| biz_area CHECK IN ('cecelia','zenithjoy','infrastructure') | migration 389 | 新行 biz_area 仅限三值 |
| journey_step_links UNIQUE (step_id, cell_kind, cell_key) | migration 349 | 格子插入需 ON CONFLICT |
| 最高 migration 号 396 | migrations/ 目录 | 新 migration 从 397 起编 |

---

## 验收标准（AC）

- [ ] AC-1：`SELECT COUNT(*) FROM journeys WHERE parent_journey_id IS NULL AND status='active' AND biz_area='cecelia'` = **2**
- [ ] AC-2：工厂线子 Capability 计数 = **6**（F0/F1/F2/F3/F4/MJ5）
- [ ] AC-3：管家线子 Capability 计数 = **5**（G1/G2/G3/G4/G5）
- [ ] AC-4：迁移前 4 条 in_progress 任务的 `anchor.journey_id` 在 journeys 表中各有 1 行匹配（`status` 可为 active 或任意值，但行存在）
- [ ] AC-5：F1 挂片分拣：ZenithJoy 相关挂片已迁至对应 zenithjoy biz_area 的 journey，F1 剩余挂片数可查且有注释说明
- [ ] AC-6：`SELECT COUNT(*) FROM journey_features WHERE journey_id IS NULL AND status != 'deprecated'` = **0**
- [ ] AC-7：`SELECT COUNT(*) FROM journey_features WHERE kind = 'enabler' AND status != 'deprecated'` >= **7**
- [ ] AC-8：所有 migration（397-400）在空库上幂等执行两次无报错
- [ ] AC-9：`brain-ci.yml` 全绿，PR 合并后 Brain 任务 f491a8dd 状态回写 `completed`

---

## 产物清单

| 文件路径 | 说明 |
|---|---|
| `packages/brain/migrations/397_journeys_capability_self_ref.sql` | schema: parent_journey_id + capability_code |
| `packages/brain/migrations/398_seed_two_value_streams_11_capabilities.sql` | 数据: 2条价值流 + 11个Capability |
| `packages/brain/migrations/399_journey_features_orphan_retire.sql` | 数据: 孤儿归位/retire |
| `packages/brain/migrations/400_cross_cutting_concerns_pool.sql` | 数据: 7项横切件登记 |

---

## 元数据

```
journey_type: dev_pipeline
target_environment: Brain PostgreSQL (cecelia DB)
biz_area: cecelia
sprint_dir: sprints/08101234-cecelia-map-reorg
task_id: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
decision_ref: 4bc109e9-3b70-4b17-a1b4-bcd01bfae776
```
