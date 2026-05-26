# Brain DB 8张表统一架构 Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 本地 Brain DB 8 张独立表 1:1 对应 Notion 8 张表，彻底去掉 system_registry 的 type 混用模式。

**Architecture:** 4 个独立变更单元顺序执行：Migration（新建表+数据迁移）→ 路由修复（按 type 路由到正确表）→ notion-push-sync 扩展（同步新增 3 张表）。

**Tech Stack:** PostgreSQL migrations, Node.js Express routes, Notion API

---

## 最终表映射（本地 ↔ Notion）

| 本地表 | Notion DB ID | 同步方向 |
|--------|-------------|---------|
| `journeys` | 358c40c2-ba63-8148-bde7-e313d789931a | 本地→Notion |
| `journey_steps` | 369c40c2-ba63-812c-9f35-e7e43db25014 | 本地→Notion |
| `journey_step_links` | 369c40c2-ba63-81e2-b95a-e5e3d0592676 | 本地→Notion |
| `journey_features` | 358c40c2-ba63-81e3-96c5-d762b3d34dff | 本地→Notion（已有） |
| `skill_registry` | 353c40c2-ba63-81bf-ae3e-f0e6fa3753d7 | 本地→Notion |
| `api_registry` | — | 机器扫描表，不同步 Notion |
| `db_schema_registry` | — | 机器扫描表，不同步 Notion |
| `test_registry` | — | 机器扫描表，不同步 Notion |

---

## 单元 1 — Migration 283：skill_registry 独立表

**文件：** `packages/brain/migrations/283_skill_registry_and_journey_step_links.sql`

```sql
-- 1. skill_registry 独立表
CREATE TABLE IF NOT EXISTS skill_registry (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  name             VARCHAR(200) NOT NULL UNIQUE,
  description      TEXT,
  location         VARCHAR(500),
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','deprecated','planned')),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  metadata         JSONB        NOT NULL DEFAULT '{}',
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_registry_status   ON skill_registry (status);
CREATE INDEX IF NOT EXISTS idx_skill_registry_notion   ON skill_registry (notion_id) WHERE notion_id IS NOT NULL;

-- 迁移数据：system_registry type='skill' → skill_registry
INSERT INTO skill_registry (name, description, location, status, metadata, created_at, updated_at)
SELECT
  name,
  description,
  location,
  COALESCE(status, 'active'),
  COALESCE(metadata::jsonb, '{}'),
  created_at,
  updated_at
FROM system_registry
WHERE type = 'skill'
ON CONFLICT (name) DO NOTHING;

-- 2. journey_step_links 连接表
CREATE TABLE IF NOT EXISTS journey_step_links (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  journey_id       UUID         NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  step_id          UUID         NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
  step_order       INT          NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','in_progress','done','skipped')),
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_step_links_journey ON journey_step_links (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_step_links_step    ON journey_step_links (step_id);
```

---

## 单元 2 — 路由修复

### 2a. `packages/brain/src/routes/skills.js`（新文件）

`/api/brain/skills` 路由，CRUD 操作 `skill_registry` 表：
- `GET /api/brain/skills` — 列表，支持 `?status=` 过滤
- `POST /api/brain/skills` — 创建
- `PATCH /api/brain/skills/:id` — 更新

### 2b. `packages/brain/src/routes/registry.js`（修改）

按 type 分流到正确表：
- `type=skill` → `skill_registry` 表（不再走 system_registry）
- `type=api` → `api_registry` 表
- `type=db_schema` → `db_schema_registry` 表
- `type=test` → `test_registry` 表

### 2c. `packages/brain/src/routes/journeys.js`（修改）

补全缺失接口：
- `GET /api/brain/journeys` — 列表（目前只有 GET /:id）
- `GET /api/brain/journey_steps` — 列表
- `POST /api/brain/journey_steps` — 创建
- `GET /api/brain/journey_step_links` — 列表
- `POST /api/brain/journey_step_links` — 创建

### 2d. `packages/brain/src/routes.js`（修改）

挂载 skills router：`router.use('/skills', skillsRouter)`

---

## 单元 3 — notion-push-sync 扩展

**文件：** `packages/brain/src/notion-push-sync.js`（修改，+3 个新函数）

新增 3 个 push 函数，与现有模式一致（查 `notion_synced_at IS NULL LIMIT 10` → Notion POST → 回写 notion_id）：

### `pushSkillRegistry()`

查 `skill_registry WHERE notion_synced_at IS NULL`，upsert 到 Notion Skill Registry（DB: `353c40c2-ba63-81bf-ae3e-f0e6fa3753d7`）：
- `Name`：skill name
- `Description`：description
- `Status`：status → select

### `pushJourneySteps()`

查 `journey_steps WHERE notion_synced_at IS NULL`，upsert 到 Notion AI Steps（DB: `369c40c2-ba63-812c-9f35-e7e43db25014`）：
- `Name`：step name
- Journey relation（通过 journeys.notion_id join）

### `pushJourneyStepLinks()`

查 `journey_step_links WHERE notion_synced_at IS NULL`，upsert 到 Notion Journey-Step 连接表（DB: `369c40c2-ba63-81e2-b95a-e5e3d0592676`）：
- Journey + Step relation（两侧都需要 notion_id 已存在）

---

## 测试策略

### E2E / Smoke（跨进程，真 DB）

**文件：** `packages/brain/scripts/smoke/8table-schema-smoke.sh`

验收条件：
- `GET /api/brain/skills` 返回 200，至少 50 条（迁移成功）
- `GET /api/brain/journeys` 返回 200，返回列表
- `GET /api/brain/journey_steps` 返回 200
- `GET /api/brain/journey_step_links` 返回 200
- `GET /api/brain/registry?type=skill` 路由到 skill_registry（不走 system_registry）

### Integration Tests

**文件：**
- `packages/brain/src/routes/__tests__/skills.test.js`
- `packages/brain/src/routes/__tests__/registry-routing.test.js`

覆盖：每个端点的 200/400/404 场景，type 路由分流正确性

### Unit Tests

**文件：** `packages/brain/src/__tests__/skill-migration.test.js`

覆盖：迁移逻辑（50 条数据完整迁移，name 唯一冲突处理）
