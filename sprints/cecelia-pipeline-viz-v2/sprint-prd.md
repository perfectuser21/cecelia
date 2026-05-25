# Sprint PRD — Cecelia Pipeline 可视化 v2（Dashboard Initiative 详情面板）

## OKR 对齐

- **对应 KR**：KR-可观测性（harness pipeline 全链路可视化）
- **当前进度**：WS 进度面板已上线（PR #3098/#3100），详情面板部分合并（PR #3106）
- **本次推进预期**：补全 PRD/合约/截图/报告全链路，使 initiative 详情页可生产使用

## 背景

Harness pipeline 已能执行 5 阶段任务，但执行结果（PrepPRD 内容、GAN 合约、WS 截图、最终 E2E 截图、报告时间轴）无法在 Dashboard 中查看。本次补全这条可视化链路。

## Golden Path（核心场景）

用户从 [HarnessPipelinePage initiative 列表] → 点击任意 initiative card → 侧栏/抽屉展开 → 看到完整 PrepPRD 文本、GAN 合约 DoD 列表、每个 WS 截图、Final E2E 截图，以及含步骤时间轴和问题发现的报告。

具体：
1. 用户在 Dashboard 点击 initiative card（data-testid: `initiative-card`）
2. Dashboard 调用 `GET /api/brain/harness/initiative/:id/detail`，拿到 PRD/合约/截图/报告
3. 详情面板（`initiative-detail-panel`）展开，展示：
   - PRD 全文 Markdown（`initiative-prd-content`）
   - 合约 DoD 列表（`initiative-contract-content`）
   - 步骤时间线（`initiative-step-timeline`，每步含开始/结束/耗时）
   - 截图区块（`screenshot_urls` 非空时渲染真实图片，非占位符）
4. 出口：用户能读到完整 PrepPRD、合约条目、截图图片、时间轴和 ws_issues

## Response Schema（WS2 API — GET /api/brain/harness/initiative/:id/detail）

**Success (HTTP 200)**:
```json
{
  "initiative_id": "<string>",
  "prd_content": "<string|null>",
  "contract_content": "<string|null>",
  "gan_rounds": "<number|null>",
  "step_timing": [
    {"ws_id": "<string>", "started_at": "<ISO8601|null>", "completed_at": "<ISO8601|null>", "duration_sec": "<number|null>"}
  ],
  "screenshot_urls": ["<string>"],
  "report_content": {
    "step_timing": [],
    "ws_issues": [{"ws_id": "<string>", "feedback": "<string>", "ci_fail_type": "<string|null>"}],
    "ws_costs": [{"ws_id": "<string>", "cost_usd": "<number>"}]
  }
}
```

**顶层 keys 完整性**：完全等于 `["initiative_id","prd_content","contract_content","gan_rounds","step_timing","screenshot_urls","report_content"]`

**禁用字段名**：`steps`/`timeline`/`result`/`data`/`details`/`info`/`timings`/`timing`/`issues`/`costs`/`breakdown`

**Error (HTTP 404)**:
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason`

## 边界情况

- `prd_content` 为 null 时面板显示占位文字（非报错）
- `screenshot_urls` 为空数组时截图区块隐藏
- `report_content.ws_issues` 为空数组时不显示问题列表

## 范围限定

**在范围内**：
- WS1: mac_web 合约模板注入截图 DoD 条目
- WS2: Brain API `/initiative/:id/detail` 端点
- WS3: Dashboard 详情面板（接 PR #3106 框架）
- WS4: reportNode 增强（step_timing/ws_issues/ws_costs）
- WS5: E2E 截图链路端到端验收

**不在范围内**：截图自动上传 CDN、视频回放、多 initiative 对比视图

## 假设

- [ASSUMPTION: PR #3106 的 HarnessPipelinePage 框架已合并，WS3 接续该框架]
- [ASSUMPTION: Brain execa bug PR #3109 已合并，Docker 已重建]
- [ASSUMPTION: screenshot_urls 存储在 ~/claude-output/harness-screenshots/ 本地路径]

## 预期受影响文件

- `packages/workflows/skills/harness-contract-proposer/SKILL.md`: WS1 截图 DoD 模板注入
- `packages/brain/src/routes/harness.js`: WS2 新增 /detail 路由
- `packages/brain/src/__tests__/harness-detail.test.js`: WS2 单测（新建）
- `packages/brain/src/workflows/harness-initiative.graph.js`: WS4 reportNode 增强
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`: WS3 详情面板

## journey_type: user_facing
## journey_type_reason: WS3 涉及 apps/dashboard/ React UI，initiative 详情面板是用户交互核心场景
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 内网产品，本机 Playwright 访问 localhost:5174 验收 UI 交互
