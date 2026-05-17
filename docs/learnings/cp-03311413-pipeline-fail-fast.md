# Learning: Content Pipeline Fail-Fast（2026-03-31）

## 问题描述

Content pipeline 在缺少 `notebook_id` 或无有效 findings 时静默继续，pipeline 显示成功但产出为空（0 图、假文案）。

### 根本原因

防御性 fallback 在数据管道中造成了静默 bug：

1. `executeResearch`：无 `notebook_id` 时生成 brand_relevance=2 的占位 findings，不报错，但该数据会被后续 `brand_relevance >= 3` 的过滤器滤掉，导致 copywriting 和 export 都收到空数据
2. `executeCopywriting`：findings 为空时使用 `fallbackCopyBlocks` 生成无素材的模板文案，数据质量极差但流程正常运行
3. `executeExport`：`generateCards` 返回 false（无有效 findings）时仍然返回 `{success: true, card_count: 0}`，UI 显示成功但无图片
4. POST `/api/brain/pipelines` 路由：创建时不读取 content-type YAML 中的 `notebook_id` 字段，每次都需要手动传入，容易漏传

### 下次预防

- [ ] 数据管道每个阶段必须在入口验证所需的前置数据，失败立即返回 `{success: false, error: "具体原因"}`，绝对不使用 fallback/占位数据
- [ ] 配置型必填参数（如 `notebook_id`）应在请求入口统一从配置中自动填充，不要依赖调用方记住传参
- [ ] 测试 executor 时必须为依赖 filesystem 的函数（如 `_loadFindings`）提供符合 slug 匹配逻辑的 mock 目录名，否则 findings 默认为空导致测试与预期不符

## 修复方案

- `executeResearch`：无 `notebookId` → `{success: false, error: "notebook_id 未配置..."}`
- `executeCopywriting`：`top.length === 0` → `{success: false}`，删除 `fallbackCopyBlocks` / `fallbackArticleSections`
- `executeExport`：`!cardsGenerated` → `{success: false, error: "有效 findings 为 0..."}`
- POST `/api/brain/pipelines`：创建时调用 `getContentType()` 自动读取 `notebook_id`
