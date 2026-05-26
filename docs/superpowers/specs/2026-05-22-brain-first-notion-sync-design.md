# Sprint B — Brain 优先写入 + 异步 Notion 推送 设计文档

**日期**：2026-05-22  
**前提**：Sprint A（migration 281，PR #3087）已合并到 main

---

## 目标

将 walking-skeleton 系列脚本从「Notion-first」改写为「Brain-first」，使 Brain DB 成为唯一写入终点，Notion 降为只读展示层，通过异步批量推送保持同步。

---

## 架构概览

```
用户调 init-journey.js / add-feature.js / thicken.js / notion-create-issue.js
  ↓
POST localhost:5221/api/brain/journeys（或 /journey_features / /issues）
  ↓
Brain DB 写入（notion_synced_at = NULL）← 唯一真相源
  ↓ 立即返回成功
  
Brain tick（每 5 分钟）
  ↓
notion-push-sync.js
  ↓
SELECT * FROM journeys WHERE notion_synced_at IS NULL LIMIT 10（+其余两表）
  ↓
调 Notion API 创建/更新页面
  ↓
UPDATE notion_id = <page_id>, notion_synced_at = NOW()
```

---

## 组件设计

### 组件 0（前置）：导出 notionReq

**文件**：`packages/brain/src/recurring-notion-sync.js`  
**改动**：将内部 `notionReq()` 函数改为 named export，供 `notion-push-sync.js` 复用。  
**理由**：避免重复实现 Notion HTTP 调用（含超时 30s、错误处理）。

### 组件 1：Brain 路由 — journeys / journey_features

**文件**：`packages/brain/src/routes/journeys.js`（新建）

| 端点 | 方法 | 功能 |
|---|---|---|
| `/api/brain/journeys` | POST | 写 journeys 表，notion_synced_at=NULL，返回行 |
| `/api/brain/journeys/:id` | GET | 读单条 Journey |
| `/api/brain/journey_features` | POST | 写 journey_features 表，notion_synced_at=NULL |
| `/api/brain/journey_features/:id` | PATCH | 更新 thickness/status（thicken.js 用） |

**写入字段**（POST /api/brain/journeys）：
```json
{
  "name": "string（必填）",
  "journey_type": "user_facing|autonomous|dev_pipeline|agent_remote（必填）",
  "description": "string",
  "maturity": "not_started（默认）",
  "status": "active（默认）",
  "area": "string",
  "e2e_test_path": "string",
  "steps": ["step1", "step2", ...]
}
```

**响应**：返回 DB 行，含 `id`（UUID）、`notion_synced_at: null`（标记待同步）。

### 组件 2：Brain 路由 — issues

**文件**：`packages/brain/src/routes/issues.js`（新建，或挂到现有路由）

| 端点 | 方法 | 功能 |
|---|---|---|
| `/api/brain/issues` | POST | 写 issues 表，notion_synced_at=NULL |

**写入字段**：
```json
{
  "title": "string（必填）",
  "priority": "P0|P1|P2|P3（默认 P2）",
  "status": "In progress（默认）",
  "sub_area": "brain|engine|dashboard|zenithjoy|multi-agent",
  "body": "string",
  "pr_url": "string"
}
```

### 组件 3：notion-push-sync.js

**文件**：`packages/brain/src/notion-push-sync.js`（新建）

**接口**：
```javascript
export async function runNotionPushSync(pool) {
  // 扫描 journeys/journey_features/issues WHERE notion_synced_at IS NULL
  // 每张表最多 10 行/次
  // 调 notionReq() 推送
  // 成功: UPDATE notion_id, notion_synced_at=NOW()
  // 失败: 记录 notion_sync_log，notion_synced_at 保持 NULL（下次重试）
}
```

**Notion 写入映射**：

| Brain 表 | Notion DB | 关键字段映射 |
|---|---|---|
| journeys | JOURNEY_DB（358c40c2-ba63-8148-bde7-e313d789931a） | name→Name, journey_type→Journey Type, maturity→Maturity, area→Area(relation) |
| journey_features | FEATURE_DB（358c40c2-ba63-81e3-96c5-d762b3d34dff） | name→Name, thickness→Thickness, journey_id→Journey(relation via notion_id) |
| issues | ISSUES_DB（a17c40c2-ba63-82fb-9888-8152cefe29ec） | title→Issue, priority→Priority, sub_area→Sub Area(relation) |

**限流**：每张表每轮 ≤10 行，三张表总计 ≤30 Notion API 调用/tick。

**错误处理**：
- Notion API 超时（30s）→ 跳过，notion_synced_at 保持 NULL
- 记录 `notion_sync_log`（direction='push', source='notion-push-sync'）

### 组件 4：tick.js 集成

**文件**：`packages/brain/src/tick.js`（或 tick-runner.js，按现有模式）

在现有 tick 周期中注册 `runNotionPushSync` 调用：
```javascript
// 在 tick 周期末尾（低优先级）
await runNotionPushSync(pool);
```

每 tick 周期调用一次，tick 频率由现有配置决定（不新增配置项）。

### 组件 5：脚本改写（Brain-first）

**init-journey.js**（`~/.claude/skills/walking-skeleton/scripts/`）：
- 删除：直接 POST Notion API 的代码
- 新增：`POST localhost:5221/api/brain/journeys`
- 保留：步骤解析、参数校验、area 查询逻辑（Brain API 内部处理 Notion 细节）

**add-feature.js**（同目录）：
- 删除：直接 POST Notion API 的代码
- 新增：`POST localhost:5221/api/brain/journey_features`
- 保留：Maturity gating 逻辑（在 Brain API 端实现，脚本简化）

**thicken.js**（同目录）：
- 删除：直接 PATCH Notion API 的代码
- 新增：`PATCH localhost:5221/api/brain/journey_features/:id`
- 保留：replaces_old_thin 校验、两段式 commit 指导

**notion-create-issue.js**（`scripts/`，仓库内）：
- 删除：直接 POST Notion API 的代码
- 新增：`POST localhost:5221/api/brain/issues`
- 保留：sub_area 自动推断逻辑（git diff 检测）

---

## 测试策略

| 层级 | 覆盖内容 | 文件 |
|---|---|---|
| Unit | journeys.js + issues.js 路由（mock pool） | `src/__tests__/journeys-api.test.js` |
| Unit | notion-push-sync.js 同步逻辑（mock notionReq + mock pool） | `src/__tests__/notion-push-sync.test.js` |
| Smoke | Brain API 写 DB + notion_synced_at=NULL 端到端验证 | `scripts/smoke/notion-brain-first-smoke.sh` |

**Notion API 实际调用**：属运行时集成（需真 token + Notion DB 权限），不纳入 CI 自动测试，由本地手动 smoke 验证。

---

## 不在范围内

- journey_steps 的 Notion 同步（step 数据通过 Notion relation 展示，由 journeys 的 steps 字段间接维护）
- Notion→Brain 反向同步（Sprint A 已做一次性引导，此后禁止反向）
- api_registry / db_schema_registry / test_registry 的 Notion 同步（无对应 Notion DB）

---

## 依赖关系

```
Sprint A (PR #3087) ← 必须先合并
  ↓
组件 0: export notionReq
  ↓
组件 1 + 2: Brain 路由（并行）
  ↓
组件 3: notion-push-sync.js（依赖组件 0）
  ↓
组件 4: tick 集成（依赖组件 3）
  ↓
组件 5: 脚本改写（依赖组件 1+2 端点存在）
```

---

## 成功标准

1. `init-journey.js --name X` 执行后：`journeys` 表有对应行，`notion_synced_at=NULL`
2. Brain tick 运行后：对应 Notion Journey 页面被创建，`notion_synced_at` 更新为非 NULL
3. `notion-create-issue.js --title X` 执行后：`issues` 表有对应行
4. 所有旧 Notion-direct 代码已删除（无遗留 mock/hardcode）
