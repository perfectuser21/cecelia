# 合同草案：Cecelia 承诺地图归位

**Sprint ID**: 08101234-cecelia-map-reorg
**Task ID**: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
**合同版本**: v1（首轮）
**日期**: 2026-08-10
**决策依据**: decisions.id = 4bc109e9-3b70-4b17-a1b4-bcd01bfae776

---

## 一、范围声明

本合同约束 Brain PostgreSQL（cecelia DB）的以下数据库变更：

1. `journeys` 表新增自引用字段 `parent_journey_id` + `capability_code`（Migration 397）
2. 插入 2 条价值流顶层行（VS_FACTORY / VS_STEWARD），并将 11 个现行 journey 行归位为子 Capability（Migration 398）
3. 孤儿挂片（`journey_id IS NULL`）与 MJ1/[v1] 滞留挂片的 retire 处理（Migration 399）
4. 7 项横切件以 `kind = 'enabler'` 登记到 `journey_features`（Migration 400）

---

## 二、不变量（Invariants）

| # | 约束 | 违反后果 |
|---|---|---|
| I-1 | 所有 DB 变更必须走 `packages/brain/migrations/NNN_*.sql`，禁止手工 psql | CI 门禁失效 |
| I-2 | 不能物理 DELETE 任何 journey 行；只能 `status = 'deprecated'` | journey_features FK 变孤儿 |
| I-3 | 4 条 in_progress 任务的 `anchor.journey_id`（d33c81ab / 9b3a2609 / 61f7a4dd / f491a8dd）在迁移后仍可在 journeys 表找到行 | anchor-check.js 运行时报错 |
| I-4 | `journey_type` 枚举仅限 `user_facing / autonomous / dev_pipeline / agent_remote`，不扩展 | INSERT CHECK 约束报错 |
| I-5 | `biz_area` 枚举仅限 `cecelia / zenithjoy / infrastructure` | INSERT CHECK 约束报错 |
| I-6 | 所有 migration 幂等，重复执行不报错 | 生产 replay 崩溃 |

---

## 三、功能承诺（FR 映射）

| FR | 产物 Migration | 技术摘要 |
|---|---|---|
| FR-1 | 397 | `ADD COLUMN IF NOT EXISTS parent_journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL` + `capability_code TEXT` + 唯一索引 |
| FR-2 | 398 | INSERT 两条顶层行（`parent_journey_id = NULL`，`journey_type = 'dev_pipeline'`，`status = 'active'`，`biz_area = 'cecelia'`） |
| FR-3 | 398 | UPDATE 存量行设 `parent_journey_id` + `capability_code`；G3/G5 INSERT 新行 |
| FR-4 | 人工核查 SQL（migration 注释形式） | 列出 F1 挂片候选，AI 不自动迁移，由人工确认 |
| FR-5 | 399 | `UPDATE journey_features SET status='deprecated' WHERE journey_id IS NULL`；MJ1/[v1] 系列挂片同步 retire |
| FR-6 | 400 | INSERT 7 条 `kind = 'enabler'` 行，`ON CONFLICT DO NOTHING` |
| FR-7 | 测试文件 | 5 条验收 SQL 封装为可执行测试 |

---

## 四、E2E 验收

> 本段是合同的核心断言层。所有断言均为针对 Brain PostgreSQL（cecelia DB）的 SQL 计数查询，结果必须精确匹配期望值。

### AC-1：2 条 active 价值流存在

```sql
SELECT COUNT(*) FROM journeys
WHERE parent_journey_id IS NULL
  AND status = 'active'
  AND biz_area = 'cecelia';
```

**期望值**: `2`

**判定逻辑**: 返回值 = 2 → PASS；否则 FAIL

---

### AC-2：工厂线 6 个 Capability

```sql
SELECT COUNT(*) FROM journeys
WHERE parent_journey_id = (
  SELECT id FROM journeys WHERE capability_code = 'VS_FACTORY'
)
AND status = 'active';
```

**期望值**: `6`（F0/F1/F2/F3/F4/MJ5）

**判定逻辑**: 返回值 = 6 → PASS；否则 FAIL

---

### AC-3：管家线 5 个 Capability

```sql
SELECT COUNT(*) FROM journeys
WHERE parent_journey_id = (
  SELECT id FROM journeys WHERE capability_code = 'VS_STEWARD'
)
AND status = 'active';
```

**期望值**: `5`（G1/G2/G3/G4/G5）

**判定逻辑**: 返回值 = 5 → PASS；否则 FAIL

---

### AC-4：4 条 in_progress 任务锚点不断裂

```sql
SELECT COUNT(DISTINCT j.id)
FROM journeys j
WHERE j.id IN (
  SELECT (payload->'anchor'->>'journey_id')::UUID
  FROM tasks
  WHERE id IN (
    'd33c81ab-0000-0000-0000-000000000000',
    '9b3a2609-0000-0000-0000-000000000000',
    '61f7a4dd-0000-0000-0000-000000000000',
    'f491a8dd-b0e3-4352-a5e0-6cb85df73d80'
  )
  AND payload->'anchor'->>'journey_id' IS NOT NULL
);
```

**判定逻辑**: 返回值与实际有 anchor.journey_id 的任务数匹配（每个 anchor journey_id 均可在 journeys 表找到行）

> 注：实际 UUID 前缀已知的两条锚：`e6f803f2-...`（F1）、`8bb8252f-...`（F5/G1）。验收脚本应直接查这两行是否存在。

```sql
-- 直接验收：两条关键锚 journey 行存在
SELECT COUNT(*) FROM journeys
WHERE id IN (
  'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29',
  '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'
);
```

**期望值**: `2`

---

### AC-5：F1 挂片分拣可核查

```sql
-- 可读：列出 F1 下的所有挂片候选（人工核查用，不是自动断言）
SELECT id, name, "group", status FROM journey_features
WHERE journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'
ORDER BY "group", name;
```

**期望行为**: 查询无报错，ZenithJoy 相关行的 `journey_id` 已迁移至 zenithjoy biz_area 的 journey（人工确认后记录在 migration 注释中）

---

### AC-6：孤儿挂片归零

```sql
SELECT COUNT(*) FROM journey_features
WHERE journey_id IS NULL
  AND status != 'deprecated';
```

**期望值**: `0`

**判定逻辑**: 返回值 = 0 → PASS；否则 FAIL

---

### AC-7：横切件池 7 项可查

```sql
SELECT COUNT(*) FROM journey_features
WHERE kind = 'enabler'
  AND status != 'deprecated';
```

**期望值**: `>= 7`

**判定逻辑**: 返回值 ≥ 7 → PASS；否则 FAIL

---

### AC-8：Migration 幂等性

```bash
# 在同一 cecelia DB 上连续执行两次 migration 397–400，均无报错
psql $DATABASE_URL -f packages/brain/migrations/397_journeys_capability_self_ref.sql
psql $DATABASE_URL -f packages/brain/migrations/397_journeys_capability_self_ref.sql
# 期望：第二次执行无 ERROR 输出
```

---

### AC-9：CI 全绿 + 任务回写

- `brain-ci.yml` 所有 check 通过（GitHub Actions 绿色）
- PR 合并后执行 `PATCH /api/brain/tasks/f491a8dd-b0e3-4352-a5e0-6cb85df73d80` 将状态回写为 `completed`

---

## 五、判定点汇总（共 9 个判定点）

| 判定点 | SQL/命令 | 期望 | 类型 |
|---|---|---|---|
| J-1 | AC-1 价值流计数 | = 2 | SQL COUNT |
| J-2 | AC-2 工厂 Capability 计数 | = 6 | SQL COUNT |
| J-3 | AC-3 管家 Capability 计数 | = 5 | SQL COUNT |
| J-4 | AC-4 关键锚 journey 行存在 | = 2 | SQL COUNT |
| J-5 | AC-5 F1 挂片列表可查 | 无报错，ZenithJoy 行已迁 | SQL 可查 |
| J-6 | AC-6 孤儿归零 | = 0 | SQL COUNT |
| J-7 | AC-7 横切件池计数 | >= 7 | SQL COUNT |
| J-8 | AC-8 Migration 幂等 | 无 ERROR | bash 执行 |
| J-9 | AC-9 CI + 任务回写 | CI 绿 + PATCH 成功 | HTTP + CI |

---

## 六、交付物边界

| 文件 | 责任 | 产出形式 |
|---|---|---|
| `migrations/397_*.sql` | Planner/Dev | 可执行 SQL |
| `migrations/398_*.sql` | Planner/Dev | 可执行 SQL |
| `migrations/399_*.sql` | Planner/Dev | 可执行 SQL |
| `migrations/400_*.sql` | Planner/Dev | 可执行 SQL |
| `sprints/.../tests/verify-map-reorg.sh` | 本合同 | 可执行 bash 验收脚本 |
| `sprints/.../tests/verify-map-reorg.sql` | 本合同 | 可执行 SQL 验收文件 |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| map-reorg DB 验收 | `tests/verify-map-reorg.sh` | B-1 价值流=2 / B-2 工厂6+管家5 / B-3 锚点不断裂 / B-4 孤儿归零+横切件>=7 / B-5 migration幂等 / B-6 schema字段 | → FAIL（migration 未执行时 schema 不存在） |

---

## 七、本合同不覆盖的内容

- F1 挂片具体分拣结果（需人工确认后写入 migration 注释）
- G3/G5 新建 Capability 的具体业务描述（由产品确认）
- brain-ci.yml 的 job 具体内容（已有，不修改）
