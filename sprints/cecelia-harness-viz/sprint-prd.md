# Sprint PRD — Harness WS 进度可视化（/pipeline 页面）

## OKR 对齐

- **对应 KR**：提升 Cecelia harness 可观测性
- **本次推进预期**：/pipeline 每个 in_progress initiative card 实时显示 WS1/WS2/WS3 子任务进度

## 背景

/pipeline 页面（HarnessPipelinePage.tsx）显示 harness_initiative 任务，但所有 WS 阶段为 not_started。原因：pipeline-detail API 依赖 cecelia_events.langgraph_step 事件，新版 full-graph executor 不 emit 这些事件。实际 WS 进度存储于 checkpoint_blobs 表，线程 ID 格式为 `harness-task:{initiative_id}:ws{n}`。

## Golden Path（核心场景）

从 [用户访问 /pipeline 页面] → 经过 [in_progress initiative card 调 ws-progress API、读 checkpoint_blobs] → 到达 [卡片 status badge 下方显示 WS 进度行]

具体：
1. 用户打开 http://perfect21:5211/pipeline
2. 页面对每个 status=in_progress 的 initiative 调用 GET /api/brain/harness/initiative/:id/ws-progress
3. 每个 pipeline card status badge 下方显示：`ws_id | 标题（≤30字）| 状态图标 | verdict badge | PR 链接`

## Response Schema

### Endpoint: GET /api/brain/harness/initiative/:id/ws-progress

**URL Parameters**:
- `id` (string, 必填): initiative UUID

**Success (HTTP 200)**:
```json
{
  "initiative_id": "46fef18e-5447-4717-a6bc-6cf30d628e03",
  "workstreams": [
    {
      "ws_id": "ws1",
      "title": "Brain API",
      "status": "merged",
      "evaluate_verdict": "PASS",
      "pr_url": "https://github.com/...",
      "fix_round": 0,
      "container_id": null
    }
  ]
}
```
- `initiative_id` (string, 必填): 同请求 id
- `workstreams` (array, 必填): WS 进度列表，长度 0-3
- `workstreams[].ws_id` (string): `"ws1"` | `"ws2"` | `"ws3"`
- `workstreams[].status` (string|null): checkpoint channel 值
- `workstreams[].evaluate_verdict` (string|null): `"PASS"` | `"FAIL"` | null
- `workstreams[].pr_url` (string|null): PR 链接或 null
- `workstreams[].fix_round` (number): 修复轮次，默认 0
- `workstreams[].container_id` (string|null): Docker container ID 或 null

**禁用响应字段名**: `steps` / `phases` / `stages` / `result` / `data` / `ws_list`

**Error (HTTP 404)**:
```json
{"error": "initiative not found"}
```

## 边界情况

- initiative 无 WS thread → workstreams 返回 `[]`
- status=null && container_id 非空 → 视为 🔄 运行中
- status=null && container_id=null → 视为 ⬜ 待开始
- status=merged → ✅ MERGED；status=running/spawning → 🔄 运行中

## 范围限定

**在范围内**：Brain API 新增 ws-progress 端点；Dashboard pipeline card 内显示 WS 进度行；单元测试（Brain + Dashboard）
**不在范围内**：WebSocket 实时推送；WS 进度历史；非 /pipeline 页面；apps/api/ 改动

## 假设

- [ASSUMPTION: checkpoint_blobs 表 channel 字段 status/evaluate_verdict/pr_url/fix_round/containerId/task 均已存在]
- [ASSUMPTION: packages/brain/src/routes/harness.js 可直接扩展新端点]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 ws-progress 路由
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`: pipeline card 内加 WS 进度行
- `packages/brain/src/__tests__/harness-ws-progress.test.js`: 新建 Brain API 单测（mock pool）
- `apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx`: 新建 Dashboard 渲染测试（mock API）

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ React UI 页面可视化改动
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 内网产品，本机 Playwright localhost:5174 验收
