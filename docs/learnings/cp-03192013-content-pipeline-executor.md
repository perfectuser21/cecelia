---
branch: cp-03192013-content-pipeline-executor
date: 2026-03-19
type: learning
---

## 内容工厂 Pipeline Executor 全链路实现（2026-03-19）

### 根本原因
内容工厂 pipeline orchestrator 只能创建子任务但没有 executor 执行。每个阶段的子任务创建后停留在 queued 状态，需要手动通过 execution-callback API 推进，缺少自动化的执行层。

### 修复方案
新建 `content-pipeline-executors.js`，实现 4 个 executor：
- `executeResearch`：调用 NotebookLM CLI 拉取调研素材到 findings.json
- `executeGenerate`：基于 findings 生成图文文案（cards/copy.md）+ 长文（article/article.md）
- `executeReview`：检查品牌关键词命中率（≥3）和禁用词（=0）
- `executeExport`：生成 manifest.json + 在线预览 HTML

在 orchestrator 新增 `executeQueuedContentTasks()`，tick.js 每轮自动调用。

### 下次预防
- [ ] 新模块应从一开始就包含 executor，不只是 orchestrator 骨架
- [ ] NotebookLM CLI 调用需设置合理超时（120s），避免阻塞 tick
- [ ] 品牌审查规则应集中配置（base-brand.yaml），不硬编码在 JS 里
- [ ] tick 中长耗时操作应改为异步执行，防止阻塞其他任务
