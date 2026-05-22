# Dev Management Tables — Sprint A 设计文档

**日期**: 2026-05-22
**范围**: Sprint A — 数据层基础（建表 + 初始填充）
**Sprint B 范围**（本文档不含）: 自动维护 hook + harness-contract-proposer Context 注入

---

## 背景与目标

harness pipeline 反复产生孤立 hardcoded 实现，根因是 generator 进来时不知道系统已有什么 API、表结构、测试。解法是在 Brain DB 建立代码库快照表，让 contract proposer 在写合同时查询这些表并注入 Context 段。

同时，journey/feature 数据目前只存 Notion，Brain DB 无法读取，导致 harness-planner 无法从 journey steps 推导 PRD，final-e2e 只能从 contract golden path 生成而非真实 journey 路径。

**Brain DB 是真相源，Notion 是只读展示层。**

---

## 架构

```
walking-skeleton 脚本
  → 写 Brain DB（主）
  → 调 Notion API 同步（次）
  → notion_sync_log 记录日志

代码库扫描（Sprint B 触发，Sprint A 一次性填充）
  → api_registry（扫路由文件）
  → db_schema_registry（查 information_schema）
  → test_registry（扫 *.test.ts / *.spec.ts）
  → system_registry（type='skill'，扫 ~/.claude/skills/）
```

---

## 7 张新表

### 1. `journeys`

对应 Notion: AI Journey — Walking Skeleton 路径（`358c40c2-ba63-8148-bde7-e313d789931a`）

```sql
CREATE TABLE journeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id       VARCHAR(100) UNIQUE,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  journey_type    VARCHAR(50) NOT NULL DEFAULT 'user_facing',
    -- user_facing / autonomous / dev_pipeline / agent_remote
  maturity        VARCHAR(50) NOT NULL DEFAULT 'not_started',
    -- not_started / skeleton / mvp / production / mature
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  e2e_test_path   VARCHAR(500),
  area_id         UUID REFERENCES areas(id) ON DELETE SET NULL,
  notion_synced_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2. `journey_steps`

对应 Notion: AI Step Registry（`35ec40c2-ba63-8170-872a-c19cc55b63b3`）

```sql
CREATE TABLE journey_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id       VARCHAR(100) UNIQUE,
  journey_id      UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  step_number     INT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'planned',
  notion_synced_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_number)
);
```

### 3. `journey_features`

对应 Notion: AI Feature — Skeleton 上的肌肉（`358c40c2-ba63-81e3-96c5-d762b3d34dff`）

> **注意**：此表与现有 `features` 表（系统能力 smoke 状态注册表）完全不同。
> `journey_features` 跟踪 Walking Skeleton 维度的功能 thickness 状态；
> `features` 跟踪 CI smoke test 的健康状态。两表用途无关，不要混淆。

```sql
CREATE TABLE journey_features (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id       VARCHAR(100) UNIQUE,
  journey_id      UUID REFERENCES journeys(id) ON DELETE SET NULL,
  step_id         UUID REFERENCES journey_steps(id) ON DELETE SET NULL,
  name            VARCHAR(200) NOT NULL,
  thickness       VARCHAR(20) NOT NULL DEFAULT 'thin',
    -- thin / medium / thick / mature
  status          VARCHAR(20) NOT NULL DEFAULT 'planned',
    -- planned / building / done / deprecated
  area_id         UUID REFERENCES areas(id) ON DELETE SET NULL,
  unit_test_path  VARCHAR(500),
  version         VARCHAR(50),
  notion_synced_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4. `api_registry`

自动扫描填充，无 Notion 对应表。

```sql
CREATE TABLE api_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method          VARCHAR(10) NOT NULL,  -- GET / POST / PATCH / PUT / DELETE
  path            VARCHAR(500) NOT NULL,
  file_path       VARCHAR(500),
  line_number     INT,
  area            VARCHAR(50),           -- cecelia / zenithjoy
  description     TEXT,
  request_schema  JSONB,
  response_schema JSONB,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (method, path)
);
```

### 5. `db_schema_registry`

从 `information_schema` 扫描，无 Notion 对应表。

> **注意**：此表与现有 `db_schemas` 表（Dashboard 前端列宽/列序配置）完全不同。
> `db_schema_registry` 存储 PostgreSQL 真实表结构，供 generator 查询已有 schema；
> `db_schemas` 是 UI 状态管理表，两者无关。

```sql
CREATE TABLE db_schema_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      VARCHAR(200) NOT NULL UNIQUE,
  columns         JSONB NOT NULL DEFAULT '[]',
    -- [{name, type, nullable, default, primary_key}]
  indexes         JSONB NOT NULL DEFAULT '[]',
    -- [{name, columns, unique}]
  foreign_keys    JSONB NOT NULL DEFAULT '[]',
    -- [{column, references_table, references_column}]
  area            VARCHAR(50),           -- cecelia / zenithjoy / shared
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6. `test_registry`

自动扫描填充，无 Notion 对应表。

```sql
CREATE TABLE test_registry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path           VARCHAR(500) NOT NULL UNIQUE,
  test_count          INT NOT NULL DEFAULT 0,
  covered_behaviors   TEXT[] NOT NULL DEFAULT '{}',
    -- describe/it 字符串列表
  area                VARCHAR(50),       -- cecelia / zenithjoy
  test_type           VARCHAR(20),       -- unit / integration / e2e
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7. `issues`

对应 Notion: Issues（`a17c40c2-ba63-82fb-9888-8152cefe29ec`）

```sql
CREATE TABLE issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id       VARCHAR(100) UNIQUE,
  title           VARCHAR(300) NOT NULL,
  body            TEXT,
  priority        VARCHAR(5) NOT NULL DEFAULT 'P2',  -- P0 / P1 / P2 / P3
  status          VARCHAR(30) NOT NULL DEFAULT 'In progress',
    -- In progress / Closed / On Hold
  sub_area        VARCHAR(50),
    -- brain / engine / dashboard / zenithjoy / multi-agent / geo / investment
  area_id         UUID REFERENCES areas(id) ON DELETE SET NULL,
  pr_url          VARCHAR(500),
  notion_synced_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## skill_registry（复用现有表）

不新建表，向现有 `system_registry` 写入 `type='skill'` 记录。
`system_registry` 的 `UNIQUE(type, name)` 约束保证 upsert 幂等。

扫描路径：
- `~/.claude/skills/` 下每个含 `SKILL.md` 的目录
- `~/.claude-account1/plugins/cache/superpowers-marketplace/` 下的 skill

---

## 初始填充脚本

| 脚本 | 数据来源 | 输出表 |
|------|---------|--------|
| `scripts/notion-to-brain/sync-journeys.js` | Notion AI Journey DB | journeys |
| `scripts/notion-to-brain/sync-journey-steps.js` | Notion AI Step Registry | journey_steps |
| `scripts/notion-to-brain/sync-journey-features.js` | Notion AI Feature DB | journey_features |
| `scripts/notion-to-brain/sync-issues.js` | Notion Issues DB | issues |
| `scripts/scan/scan-api-registry.js` | apps/api/src/ + packages/brain/src/ | api_registry |
| `scripts/scan/scan-db-schema.js` | information_schema（本地 psql） | db_schema_registry |
| `scripts/scan/scan-test-registry.js` | **/*.test.ts, **/*.spec.ts | test_registry |
| `scripts/scan/scan-skills.js` | ~/.claude/skills/ | system_registry |
| `scripts/run-all-initial-scans.sh` | 按顺序运行以上所有脚本 | — |

---

## Notion 同步约定

- 使用现有 `notion_sync_log` 表记录每次同步（`direction: 'from_notion'` 或 `'to_notion'`）
- 初始填充：`from_notion`（Notion → Brain DB）
- walking-skeleton 脚本写入后同步：`to_notion`（Brain DB → Notion）
- 所有同步脚本读 `~/.credentials/notion.env` 获取 API Key

---

## 测试策略

| 场景 | 类型 | 验证方式 |
|------|------|---------|
| migration 后 7 张表存在 | integration | psql 查 information_schema.tables |
| api_registry 扫描后行数 > 0 | integration | psql COUNT(*) |
| db_schema_registry 含已知表（如 tasks） | integration | psql WHERE table_name='tasks' |
| test_registry 含已知测试文件 | integration | psql WHERE file_path LIKE '%brain%' |
| journey Notion 拉取正确性 | unit | mock Notion API，验 INSERT 参数 |
| issues Notion 拉取正确性 | unit | mock Notion API，验 INSERT 参数 |
| api_registry UNIQUE(method, path) 约束 | unit | 重复插入应 ON CONFLICT UPDATE |
| db_schema_registry UNIQUE(table_name) | unit | 重复插入应 ON CONFLICT UPDATE |
| skill_registry upsert 幂等 | unit | system_registry UNIQUE(type,name) 不报错 |

---

## 范围限定

**Sprint A 在范围内**：
- 7 张表的 migration（版本 281）
- 初始填充脚本（一次性）
- notion_sync_log 复用（不修改该表）

**Sprint A 不在范围内**（Sprint B 做）：
- PR merge 触发自动扫描
- walking-skeleton 脚本从 Notion 优先改为 Brain DB 优先
- harness-contract-proposer Context 注入
- Brain tick reconciliation

---

## 受影响文件

| 文件 | 变更 |
|------|------|
| `packages/brain/migrations/281_dev_management_tables.sql` | 新建，7 张表 DDL |
| `scripts/notion-to-brain/sync-journeys.js` | 新建 |
| `scripts/notion-to-brain/sync-journey-steps.js` | 新建 |
| `scripts/notion-to-brain/sync-journey-features.js` | 新建 |
| `scripts/notion-to-brain/sync-issues.js` | 新建 |
| `scripts/scan/scan-api-registry.js` | 新建 |
| `scripts/scan/scan-db-schema.js` | 新建 |
| `scripts/scan/scan-test-registry.js` | 新建 |
| `scripts/scan/scan-skills.js` | 新建 |
| `scripts/run-all-initial-scans.sh` | 新建 |
| `packages/brain/src/workflows/__tests__/dev-registry.test.js` | 新建，integration + unit tests |

## journey_type
autonomous

## journey_type_reason
纯数据建设 + 脚本，无用户界面交互，系统自动执行扫描和同步

## target_environment
local_api

## target_environment_reason
验证对象是 Brain DB（localhost:5221 + psql），所有验证命令在本地执行
