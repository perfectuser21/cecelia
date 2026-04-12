# Learning: KR5 Dashboard — Harness Pipeline 路由修复

**分支**: cp-0411214802-a2ef9e4d-f16d-4c10-94bc-586677  
**日期**: 2026-04-12

## 根本原因

Dashboard Harness Pipeline 页面使用了旧路径 `/harness-pipeline`，而 system-hub router 已统一为 `/pipeline`。导致：
- `HarnessPipelineDetailPage.tsx` 返回按钮指向 `/harness-pipeline`（404）
- `HarnessPipelineStepPage.tsx` 返回按钮指向 `/harness-pipeline/:id`（404）
- StepCards 导航链接同样使用旧前缀

## 修复内容

1. `HarnessPipelineDetailPage.tsx`：返回按钮 `/harness-pipeline` → `/pipeline`，StepCard 导航 `/harness-pipeline/${id}/step/${step}` → `/pipeline/${id}/step/${step}`
2. `HarnessPipelineStepPage.tsx`：返回按钮 `/harness-pipeline/${pipelineId}` → `/pipeline/${pipelineId}`

## 下次预防

- [ ] 路由路径统一在 `system-hub/index.ts` 定义，页面内部导航必须从 props/context 获取路径前缀，不硬编码
- [ ] 新增页面时检查 system-hub routes 中的实际 path，不要凭记忆写 URL
