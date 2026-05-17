# Feature Registry — Brain DB 设计文档

**日期**：2026-04-30  
**分支**：cp-0430113134-feature-registry-brain-db  
**状态**：APPROVED

---

## 背景

`docs/feature-ledger.yaml` 是系统所有功能的台账（159 个 feature），但它是静态文件——无法查询、无法跟踪运行时状态（smoke test 是否通过）、无法被 Agent 回填。

本次把 feature-ledger.yaml 变成活的 Brain PostgreSQL 数据库，提供 CRUD API，形成反馈回路：

```
查表 → 知道哪些 feature 缺 smoke test / 当前 failing
干完活 → PATCH 回填 smoke_status / smoke_cmd / last_verified
每周 cron → 自动跑 smoke，更新状态，推飞书
```

---

## 架构

```
feature-ledger.yaml（种子定义文件）
    ↓ POST /api/brain/features/seed（一次性 or 每次 PR 后同步）
Brain PostgreSQL: features 表（migration 249）
    ↓
GET /api/brain/features?priority=P0&smoke_status=failing
    → Agent 看哪些功能需要修
PATCH /api/brain/features/:id
    → Agent 干完活回填 smoke_cmd / smoke_status
```

---

## 数据库表设计（migration 249）

```sql
CREATE TABLE features (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  domain VARCHAR(50),
  area VARCHAR(50),
  priority VARCHAR(5),        -- P0 / P1 / P2
  status VARCHAR(20),         -- active / experimental / deprecated / unknown
  description TEXT,
  smoke_cmd TEXT,             -- null = 待补；非 null = 可执行的 curl 命令
  smoke_status VARCHAR(20) DEFAULT 'unknown',  -- unknown / passing / failing
  smoke_last_run TIMESTAMPTZ,
  has_unit_test BOOLEAN DEFAULT FALSE,
  has_integration_test BOOLEAN DEFAULT FALSE,
  has_e2e BOOLEAN DEFAULT FALSE,
  last_verified DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON features(priority);
CREATE INDEX ON features(smoke_status);
CREATE INDEX ON features(domain);
CREATE INDEX ON features(area);
```

**selfcheck.js** `EXPECTED_SCHEMA_VERSION` 从 `'248'` 升至 `'249'`。

---

## API 端点（`src/routes/features.js`，挂载 `/api/brain/features`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | / | 列表，支持过滤：`priority` / `status` / `smoke_status` / `domain` / `area` |
| GET | /:id | 单条详情 |
| POST | / | 新增 feature |
| PATCH | /:id | 更新（smoke_cmd / smoke_status / smoke_last_run / last_verified / notes 等）|
| POST | /seed | 从 feature-ledger.yaml 批量 upsert（保留已有 smoke_status / smoke_last_run）|

### GET / 查询示例

```
GET /api/brain/features?priority=P0&smoke_status=failing
GET /api/brain/features?domain=task&status=active
GET /api/brain/features?smoke_cmd=null  （待补 smoke test 的）
```

返回：`{ features: [...], total: N }`

### PATCH /:id 示例

```json
{
  "smoke_cmd": "curl -sf http://localhost:5221/api/brain/health | jq -e '.status != null'",
  "smoke_status": "passing",
  "smoke_last_run": "2026-04-30T10:00:00Z",
  "last_verified": "2026-04-30"
}
```

### POST /seed 行为

- 读 `docs/feature-ledger.yaml`
- 遍历 `features` 数组做 `INSERT ON CONFLICT (id) DO UPDATE`
- **不覆盖** `smoke_status`、`smoke_last_run`（保留运行时数据）
- 返回 `{ seeded: N, updated: M }`

---

## Seed 脚本

文件：`packages/brain/scripts/seed-features.js`

- 可独立运行：`node packages/brain/scripts/seed-features.js`
- 也可通过 API 触发：`POST /api/brain/features/seed`
- 处理 yaml 中 `notes: undefined → null`（可选字段）

---

## 测试策略

### Integration test（真 PostgreSQL）
文件：`packages/brain/src/__tests__/integration/features-registry.integration.test.js`

测试流程：
1. seed 脚本导入 feature-ledger.yaml → 验证 count > 0
2. GET /?priority=P0 → 只返回 P0 条目
3. PATCH /:id（smoke_status=passing）→ GET 验证已更新
4. 重复 seed → 验证 smoke_status 未被覆盖

### Unit test
文件：`packages/brain/src/__tests__/features-registry.test.js`

测试：list 过滤逻辑（priority / status / domain 组合查询）

### Smoke test
文件：`packages/brain/scripts/smoke/feature-registry-smoke.sh`

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
curl -sf "$BRAIN_URL/api/brain/features?priority=P0" | jq -e 'type == "array" and length > 0'
echo "✅ feature-registry smoke OK"
```

---

## 需要同步修改的文件

1. `packages/brain/migrations/249_features_registry.sql` — 建表
2. `packages/brain/src/selfcheck.js` — EXPECTED_SCHEMA_VERSION 改为 `'249'`
3. `packages/brain/src/routes/features.js` — 新建 CRUD 路由
4. `packages/brain/server.js` — 注册 featuresRoutes
5. `packages/brain/scripts/seed-features.js` — seed 脚本
6. `packages/brain/src/__tests__/features-registry.test.js` — unit test
7. `packages/brain/src/__tests__/integration/features-registry.integration.test.js` — integration test
8. `packages/brain/scripts/smoke/feature-registry-smoke.sh` — smoke test

---

## 注意事项

- migration 248（license_system）尚未合入 main，249 依赖 248 先合入
- `notes` 字段在 yaml 中是可选的，seed 脚本需处理 `undefined → null`
- `smoke_cmd` 中部分条目为 `null`，属正常状态（待补），不是错误
