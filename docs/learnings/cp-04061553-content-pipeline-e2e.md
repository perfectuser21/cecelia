# Learning: [内容产出] 内容生成→发布完整闭环打通

**Branch**: cp-04060046-8b01a2eb-e7c8-483f-816b-ff140f
**Date**: 2026-04-06

### 根本原因

content pipeline 的三个断链点：
1. `AVAILABLE_CONTENT_TYPES = ['solo-company-case']` 只有 1 种类型，选题系统无法产出多元主题内容
2. `_handleExportComplete` 直接创建 publish jobs，无质量门控，劣质内容可能直接发出
3. 缺少批量触发端点，无法一次创建多条不同类型的内容任务

### 下次预防

- [ ] 新增内容类型 YAML 后，同步检查 `topic-selector.js` 的 `AVAILABLE_CONTENT_TYPES` 是否需要更新
- [ ] export 阶段完成后的业务逻辑（_handleExportComplete）修改时，确认 pre-publish-check 路径不被绕过
- [ ] batch 端点的内容类型轮换表 `CONTENT_TYPE_ROTATION` 与 `AVAILABLE_CONTENT_TYPES` 保持一致

### 修改摘要

| 文件 | 改动 |
|------|------|
| `topic-selector.js` | `AVAILABLE_CONTENT_TYPES` 扩展到 3 个类型 |
| `content-pipeline-orchestrator.js` | `_handleExportComplete` 集成 `validateAllVariants` 质量门控；失败时标记 `pre_publish_failed` |
| `routes/content-pipeline.js` | 新增 `POST /batch-e2e-trigger` 端点，支持一次创建5条 pipeline（3种内容类型轮换） |
| `__tests__/content-pipeline-e2e-batch.test.ts` | 新增7个单元测试覆盖上述改动 |
