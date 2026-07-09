# Walking Skeleton — Notion DB Schema 速查

## DB ID（写死，避免每次查）

```
# AI Hub 9 张核心表（CCAPI2026 集成账号）
NOTION_JOURNEY_DB         = 358c40c2-ba63-8148-bde7-e313d789931a   # AI Journey（路径）
NOTION_STEPS_DB           = 369c40c2-ba63-812c-9f35-e7e43db25014   # AI Steps（步骤）
NOTION_JOURNEY_STEP_DB    = 369c40c2-ba63-81e2-b95a-e5e3d0592676   # Journey-Step 顺序连接表
NOTION_FEATURE_DB         = 358c40c2-ba63-81e3-96c5-d762b3d34dff   # AI Feature（肌肉）
NOTION_API_REGISTRY_DB    = 365c40c2-ba63-81a3-9060-fcef565e5291   # Sprint State — API Registry
NOTION_DB_SCHEMA_DB       = 365c40c2-ba63-8181-9a57-ed760fd68ba3   # Sprint State — DB Schema Registry
NOTION_TEST_REGISTRY_DB   = 365c40c2-ba63-8164-8037-eb72e713809e   # Sprint State — Tests Registry
NOTION_ISSUES_DB          = a17c40c2-ba63-82fb-9888-8152cefe29ec   # Issues
NOTION_NOTES_DB           = 185c40c2-ba63-828c-973f-81a9c4582cd6   # AI Notes（辅助，决策/日志）
```

> **CCAPI2026 访问状态**：所有 9 张表均已 share 给 CCAPI2026 集成账号 ✅

## AI Journey — Walking Skeleton 路径

| Field | Type | Options / Notes |
|---|---|---|
| Name | title | 必填 |
| Description | rich_text | 1-3 句话 |
| Journey Type | select | user_facing / autonomous / dev_pipeline / agent_remote |
| Maturity | select | not_started / skeleton / mvp / production / mature |
| Status | select | active / paused / deprecated |
| Area | relation → Areas | 必填，主 Area |
| Features | relation → Feature DB | 自动双向（Feature 端写入时同步） |
| E2E Test Path | rich_text | repo 内 smoke 路径 |

## AI Feature — Skeleton 上的肌肉

| Field | Type | Options / Notes |
|---|---|---|
| Name | title | 必填 |
| Journey | relation → Journey DB | **必填**，无主 Feature 不允许 |
| Thickness | select | thin / medium / thick / mature（默认 thin）|
| Status | select | planned / building / done / deprecated |
| Area | relation → Areas | 跟 Journey 同 Area（自动同步） |
| Version | rich_text | SemVer，如 0.1.0 |
| Unit Test Path | rich_text | 单测文件路径 |

---

## Sprint State — API Registry（章节3，新建）

| Field | Type | Options / Notes |
|---|---|---|
| Name | title | `METHOD /path`，如 `POST /api/auth/register` |
| Method | select | GET / POST / PUT / DELETE / PATCH |
| Endpoint | rich_text | 完整路径 |
| Request | rich_text | 请求体 JSON shape |
| Response | rich_text | 响应体 JSON shape（含 HTTP code）|
| Journey ID | rich_text | 对应 journey_id slug，如 `path-1-customer` |
| Status | select | active / deprecated |
| Updated In | rich_text | sprint-id，如 `sprint-0519` |

## Sprint State — DB Schema Registry（章节4，新建）

| Field | Type | Options / Notes |
|---|---|---|
| Name | title | 表名，如 `users` |
| Columns | rich_text | 列定义，如 `id, email, license_type, created_at` |
| Journey ID | rich_text | 对应 journey_id slug |
| Status | select | active / deprecated |
| Updated In | rich_text | sprint-id |

## Sprint State — Tests Registry（章节5，新建）

| Field | Type | Options / Notes |
|---|---|---|
| Name | title | 测试描述，如 `POST /api/auth/register → DB 写入` |
| Type | select | smoke / unit / integration |
| Path | rich_text | 文件路径或命令，如 `golden-path-1-smoke.sh step 1-2` |
| Status | select | passing / failing / skipped |
| Journey ID | rich_text | 对应 journey_id slug |
| Updated In | rich_text | sprint-id |

## AI Notes（章节6 Decisions，Type=Decision 过滤使用）

| Field | Type | Options / Notes |
|---|---|---|
| Title | title | 决策名 |
| Type | select | **Decision** / Research / Log / Notes |
| Date | date | 决策日期 |
| Related Areas | relation → Areas | 关联子 Area |

---


## 通用 Block 构建函数（脚本里复用）

```javascript
const h2 = t => ({object:'block',type:'heading_2',heading_2:{rich_text:[{type:'text',text:{content:t}}]}});
const h3 = t => ({object:'block',type:'heading_3',heading_3:{rich_text:[{type:'text',text:{content:t}}]}});
const p  = t => ({object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:t}}]}});
const li = t => ({object:'block',type:'bulleted_list_item',bulleted_list_item:{rich_text:[{type:'text',text:{content:t}}]}});
const todo = t => ({object:'block',type:'to_do',to_do:{rich_text:[{type:'text',text:{content:t}}],checked:false}});
const divider = () => ({object:'block',type:'divider',divider:{}});
const callout = (t,e) => ({object:'block',type:'callout',callout:{rich_text:[{type:'text',text:{content:t}}],icon:{type:'emoji',emoji:e||'💡'}}});
```

---

## 凭据（共用）

```javascript
const fs = require('fs');
const env = {};
fs.readFileSync(process.env.HOME + '/.credentials/notion.env', 'utf8')
  .split('\n').forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
// env.NOTION_API_KEY 现在就能用
```

通用 fetch 包装：
```javascript
async function notion(method, path, body) {
  const r = await fetch('https://api.notion.com/v1' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + env.NOTION_API_KEY,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) { console.error('Notion API FAIL', r.status, data); process.exit(1); }
  return data;
}
```
