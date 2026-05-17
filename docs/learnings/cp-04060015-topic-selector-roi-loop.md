---
branch: cp-04060014-f343fa2a-f1f6-444c-9020-03d183
date: 2026-04-06
task: "[SelfDrive] [选题闭环] 基于数据驱动的AI自动选题引擎"
---

# Learning: 选题闭环 — 数据驱动注入与手动触发

### 根本原因

选题引擎核心框架已存在（topic-selector / topic-suggestion-manager / scheduler / routes），但缺少两个闭环关键点：

1. **近7日 ROI 数据未注入 Prompt** — `queryWeeklyROI`（读 `content_analytics`，7日粒度）已在 `content-analytics.js` 实现，但 `generateTopics()` 只从 `topic_decision_feedback`（周粒度）读历史高热话题，没有把最新7日的平台互动数据告诉 LLM。
2. **缺少手动触发端点** — 选题只能靠每日09:00定时窗口触发，无法在开发/调试时手动验证全流程。

### 下次预防

- [ ] 新增数据分析模块（`content-analytics.js` 等）时，同步检查是否需要注入到决策/生成 Prompt
- [ ] 新的 AI 生成器上线前，优先创建手动触发端点（`POST /xxx/generate`），方便调试
- [ ] `worktree` 中测试文件依赖主仓库 `node_modules`：从 worktree 根目录直接链接 `ln -sfn /main/node_modules ./node_modules`，然后用绝对路径调用 vitest
