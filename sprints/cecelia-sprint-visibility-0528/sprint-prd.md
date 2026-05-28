# Sprint PRD — Harness Sprint 全链路可见性

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性（Cecelia Harness Journey）
- **当前进度**：30%
- **本次推进预期**：75%

## 背景

Sprint 跑完后 PrepPRD/PRD/Contract/Report 在 Notion 和 Dashboard 均不可见。
根因：(1) `/api/brain/notes`、`/api/brain/notion/project`、`/api/brain/notion/task` 三个端点不存在；
(2) harness-report skill 调用这些端点全部 404，文档从未归档 Notion；
(3) Dashboard 没有文档 tab，无法浏览 sprint 文件；
(4) execution_attempts=0 的死任务卡死，调度器无法推进。

## Golden Path（核心场景）

用户从 [Sprint 跑完触发 harness-report] → 经过 [3 个 Notion 端点写入 + PrepPRD/PRD/Contract 归档 + Dashboard 文档 tab 渲染 + 死任务自动重置] → 到达 [Notion 看到 4 页记录 + Dashboard 渲染 PrepPRD markdown + 79710a5d 状态变 queued]

具体：
1. POST /api/brain/notes 被调用 → 在 Notion AI Notes DB（`185c40c2-ba63-828c-973f-81a9c4582cd6`）新建页面，返回 `{id, url, title}`
2. POST /api/brain/notion/project 被调用 → 标题自动加 `[Sprint]` 前缀，写入 Notion Projects DB
3. POST /api/brain/notion/task 被调用 → 标题自动加 `[WSn]` 前缀（n 从 ws_number 或 title 推断），写入 Notion Tasks DB
4. harness-report Step 3.5 逐个读取 sprint 目录下 prep-prd.md / sprint-prd.md / contract-draft.md，POST 到 /api/brain/notes（type 分别为 PrepPRD / SprintPRD / Contract）
5. GET /api/brain/harness/sprint-docs?sprint_dir=... 返回 4 个文档的 markdown 内容
6. HarnessDetailPage 出现"文档"tab，点击后调用 sprint-docs 端点，渲染 markdown
7. tick-runner.js 扫描 execution_attempts=0 且卡死 ≥10 分钟的任务，自动 reset 为 queued
8. 79710a5d 任务因上述逻辑被重置为 queued

## Response Schema

### Endpoint: POST /api/brain/notes

**Body Parameters**:
- `title` (string, 必填): Notion 页面标题
- `content` (string, 必填): 页面正文（markdown）
- `type` (string, 必填): 字面量之一 `"PrepPRD"` / `"SprintPRD"` / `"Contract"` / `"Report"` / `"Note"`
- `initiative_id` (string, 可选): 关联 initiative UUID
- `sprint_dir` (string, 可选): sprint 目录路径

**Success (HTTP 201)**:
```json
{"id": "<notion_page_id>", "url": "https://notion.so/...", "title": "<string>"}
```
- `id` (string, 必填): Notion 页面 ID
- `url` (string, 必填): Notion 页面 URL
- `title` (string, 必填): 页面标题（与入参 title 相同）
- **禁用响应字段名**: `page_id` / `notion_id` / `result` / `data` / `payload`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

**Error (HTTP 502)**:
```json
{"error": "notion api error: <detail>"}
```

---

### Endpoint: POST /api/brain/notion/project

**Body Parameters**:
- `title` (string, 必填): 项目标题（端点自动加 `[Sprint]` 前缀，勿重复传入前缀）
- `status` (string, 可选): 默认 `"Done"`
- `journey_id` (string | null, 可选): 关联 Journey UUID
- `sprint_dir` (string, 可选): sprint 目录路径
- `pr_url` (string, 可选): PR 链接

**Success (HTTP 201)**:
```json
{"id": "<notion_page_id>", "url": "<string>", "title": "[Sprint] <原始title>"}
```
- `title` 必须带 `[Sprint]` 前缀
- **禁用响应字段名**: `page_id` / `notion_id` / `result` / `data`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

---

### Endpoint: POST /api/brain/notion/task

**Body Parameters**:
- `title` (string, 必填): 任务标题（端点自动加 `[WS{n}]` 前缀；若 title 已包含 `WS` 前缀则跳过）
- `ws_number` (number, 可选): WS 编号，用于前缀生成
- `status` (string, 可选): 默认 `"Done"`
- `sprint_dir` (string, 可选): sprint 目录路径

**Success (HTTP 201)**:
```json
{"id": "<notion_page_id>", "url": "<string>", "title": "<string>"}
```
- **禁用响应字段名**: `page_id` / `notion_id` / `result` / `data`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

---

### Endpoint: GET /api/brain/harness/sprint-docs

**Query Parameters**:
- `sprint_dir` (string, 必填): sprint 目录路径（如 `sprints/cecelia-sprint-visibility-0528`）
- **禁用 query 名**: `dir` / `path` / `folder` / `d` / `p` / `directory`
- **强约束**: generator 必须字面用 `sprint_dir` 作为 query 参数名

**Success (HTTP 200)**:
```json
{
  "sprint_dir": "sprints/cecelia-sprint-visibility-0528",
  "docs": {
    "prep_prd": "<markdown string or null>",
    "sprint_prd": "<markdown string or null>",
    "contract": "<markdown string or null>",
    "harness_report": "<markdown string or null>"
  }
}
```
- `docs.prep_prd`: prep-prd.md 内容（文件不存在时为 `null`）
- `docs.sprint_prd`: sprint-prd.md 内容（文件不存在时为 `null`）
- `docs.contract`: contract-draft.md 内容（文件不存在时为 `null`）
- `docs.harness_report`: harness-report.md 内容（文件不存在时为 `null`）
- **Schema 完整性**: `docs` 对象的 keys 完全等于 `["prep_prd", "sprint_prd", "contract", "harness_report"]`
- **禁用字段名**: `prepPrd` / `sprintPrd` / `contractDraft` / `report` / `prd` / `prep`（必须下划线命名）

**Error (HTTP 400)**:
```json
{"error": "sprint_dir is required"}
```

## 边界情况

- sprint_dir 下某文件不存在时，`docs` 对应字段为 `null`（不报 404）
- Notion API 不可达时，`/api/brain/notes`、`/api/brain/notion/project`、`/api/brain/notion/task` 返回 HTTP 502
- harness-report Step 3.5 失败时降级（WARN 打印，不阻断后续 Step）
- 死任务：`execution_attempts = 0 AND status IN ('in_progress','queued') AND updated_at < NOW() - INTERVAL '10 minutes'`
- WS 编号推断：title 含 `WS1`/`WS2` 等时，/api/brain/notion/task 不重复加前缀
- 79710a5d 重置由 tick-runner 新逻辑自动触发，无需手动 PATCH

## 范围限定

**在范围内**：
- 3 个 Brain API Notion 端点（`routes/notes.js` 新文件）
- harness-report SKILL.md 新增 Step 3.5（归档 PrepPRD/SprintPRD/Contract）
- GET /api/brain/harness/sprint-docs 端点（`routes/harness.js` 扩展）
- HarnessDetailPage 新增文档 tab（markdown 渲染）
- tick-runner.js 死任务重置逻辑（execution_attempts=0）
- 任务 79710a5d 被上述逻辑自动重置

**不在范围内**：
- Notion 实时双向同步
- 历史 sprint 文档批量回填
- 文档 tab 之外的 Dashboard UI 改动
- 除 79710a5d 之外的手动任务重置 API

## 假设

- [ASSUMPTION: Notion API token 与 `recurring-notion-sync.js` 同源（`notionReq` / `getToken` 可复用）]
- [ASSUMPTION: AI Notes DB ID = `185c40c2-ba63-828c-973f-81a9c4582cd6`（与 notion-push-sync.js 中 DECISIONS_DB 相同）]
- [ASSUMPTION: 死任务判定：execution_attempts=0 AND updated_at < NOW()-10min AND status IN ('in_progress','queued')]
- [ASSUMPTION: Dashboard 使用 react-markdown 或兼容库渲染 markdown；若无则 WS3 引入]
- [ASSUMPTION: HarnessDetailPage 文档 tab 通过 React state 切换，不新增路由]

## 预期受影响文件

- `packages/brain/src/routes/notes.js`: 新建（POST /notes, POST /notion/project, POST /notion/task）
- `packages/brain/src/server.js`: 注册 notes 路由
- `packages/brain/src/routes/harness.js`: 新增 GET /sprint-docs 端点
- `packages/workflows/skills/harness-report/SKILL.md`: 新增 Step 3.5 文档归档
- `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx`: 新增文档 tab
- `packages/brain/src/tick-runner.js`: 新增死任务重置逻辑

## journey_type: user_facing
## journey_type_reason: WS3 涉及 apps/dashboard/ HarnessDetailPage 文档 tab，UI 优先级最高
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard E2E 走本机 Playwright，localhost:5174，内网
