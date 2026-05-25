# Sprint PRD — Cecelia Pipeline 可视化 v2（完整详情链路）

## OKR 对齐

- **对应 KR**：Harness 可观测性（initiative 可视化完整链路）
- **当前进度**：60%（WS3 Dashboard 详情面板已完成 PR #3106）
- **本次推进预期**：100%（WS1/WS2/WS4/WS5 完成）

## 背景

WS3 Dashboard initiative 详情面板已就位，但面板依赖的后端 /detail API、截图 DoD 规范、
reportNode 字段均未实现，导致面板数据空白。本 sprint 补齐剩余四个工作流。

## Golden Path（核心场景）

运维人员从 Dashboard /pipeline 页 → 点击任意 initiative 卡片 → 侧栏展示完整详情。

具体：
1. 用户打开 /pipeline 页，initiative 卡片列表可见
2. 点击卡片后侧栏展开，前端调用 GET /api/brain/harness/initiative/:id/detail
3. 面板渲染：PrepPRD 全文（Markdown）/ 步骤时间线（step_timing 驱动）/ 截图 section（screenshot_urls 非空时展示）
4. harness evaluator 验收后截图自动存入 ~/claude-output/harness-screenshots/<ws_id>-<step>.png
5. reportNode 将 step_timing/ws_issues/ws_costs 写入 DB，/detail 端点组装并返回

## Response Schema

### GET /api/brain/harness/initiative/:id/detail

**Success (HTTP 200)**:
```json
{
  "initiative_id": "<string>",
  "prd_content": "<string|null>",
  "contract_content": "<string|null>",
  "gan_rounds": "<number|null>",
  "step_timing": [{"ws_id":"<string>","start_ts":"<iso>","end_ts":"<iso>","duration_ms":<number>}],
  "screenshot_urls": ["<string>"]
}
```
- **Schema 完整性**: 顶层 keys 完全等于 `["initiative_id","prd_content","contract_content","gan_rounds","step_timing","screenshot_urls"]`
- **禁用字段**: `steps`/`timeline`/`result`/`data`/`details`/`info`/`content`/`report`

**Error (HTTP 404)**:
```json
{"error": "<string>"}
```

### reportNode 写入 tasks.result->'report_content'
```json
{
  "step_timing": [{"ws_id":"<string>","start_ts":"<iso>","end_ts":"<iso>","duration_ms":<number>}],
  "ws_issues": [{"ws_id":"<string>","feedback":"<string>","ci_fail_type":"<string|null>"}],
  "ws_costs": [{"ws_id":"<string>","cost_usd":<number>}]
}
```
- **禁用字段**: `timings`/`timing`/`issues`/`costs`/`breakdown`

## 边界情况

- initiative 不存在 → /detail 返回 404 + `{"error":"<string>"}`
- 无截图 → screenshot_urls 为 []，面板截图 section 不渲染
- 无 PRD → prd_content 为 null，面板显示占位文本
- step_timing 无 task_events 数据时返回 []

## 范围限定

**在范围内**：
- WS1：SKILL.md mac_web 合约模板末尾注入 `[BEHAVIOR:E2E:screenshot]` 截图 DoD 条目
- WS2：Brain `GET /api/brain/harness/initiative/:id/detail` 新端点
- WS4：reportNode 新增 step_timing/ws_issues/ws_costs 三字段写入 DB
- WS5：E2E 截图链路验证（验证 harness-screenshots 目录有新 PNG + /detail 可访问）

**不在范围内**：
- WS3（已完成，PR #3106，不重复实现）
- Dashboard 其他页面改动
- Brain 其他端点变更

## 假设

- [ASSUMPTION: step_timing 从 task_events 表 graph_node_update 事件推算，无事件时返回 []]
- [ASSUMPTION: screenshot_urls 为本机文件路径，非公网 URL]
- [ASSUMPTION: SKILL.md 位于 packages/workflows/skills/harness-contract-proposer/SKILL.md]

## 预期受影响文件

- `packages/workflows/skills/harness-contract-proposer/SKILL.md`: WS1 截图 DoD 注入
- `packages/brain/src/routes/harness.js`: WS2 /detail 端点
- `packages/brain/src/__tests__/harness-detail.test.js`: WS2 单测（新建）
- `packages/brain/src/workflows/harness-initiative.graph.js`: WS4 reportNode 增强
- `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts`: WS5 E2E（新建）

## journey_type: user_facing
## journey_type_reason: 核心场景为用户在 Dashboard /pipeline 页交互，通过 /detail API 查看 initiative 详情
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 内网产品，Playwright 在本机 localhost:5174 执行 E2E 验收
