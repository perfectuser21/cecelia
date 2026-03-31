# Learning: Content Pipeline Fail-Fast 修复

**Branch**: cp-03311413-pipeline-fail-fast
**Date**: 2026-03-31
**PR**: #1742

## 问题描述

Content pipeline 存在多处静默失败：
1. 无 `notebook_id` 时 `executeResearch` 生成占位数据（brand_relevance=2），不报错
2. `executeCopywriting` 在 findings 为空时使用 `fallbackCopyBlocks` 继续生成假文案
3. `executeExport` 即使 `generateCards` 返回 false（无有效 findings）也返回 `{success: true}`
4. 创建 pipeline 时即使 YAML 配置了 `notebook_id` 也不读取

## 根因

所有 executor 函数的防御性编程模式是"宁可生成空壳结果也不失败"，导致用户看到 pipeline 成功但实际产出为空（0 图、假文案）。

## 修复方案

**直接 FAIL**：
- `executeResearch`：无 `notebookId` → `{success: false, error: "notebook_id 未配置..."}`
- `executeResearch`：NotebookLM 返空 → `{success: false, error: "..."}`
- `executeCopywriting`：top.length === 0 → `{success: false, error: "findings 为空..."}`，删除 `fallbackCopyBlocks`
- `executeExport`：`!cardsGenerated` → `{success: false, error: "有效 findings 为 0..."}`

**自动读取**：
- POST `/api/brain/pipelines`：创建时从 `getContentType()` 自动读取 `notebook_id`（请求未传入时）

## 测试影响

- 3 个旧测试（"返回占位 findings"、"fallback 不报错"）改为验证 fail-fast 行为
- 新增 3 个测试验证 notebook_id 从 YAML 自动读取
- LLM 测试需要为 copywriting mock 有效 findings（readdirSync 返回包含 keyword 的目录名）

## 关键教训

**Silent fallback = 静默 bug**：当下游逻辑依赖上游数据质量时，fallback 会将错误传导到更难排查的位置。对于数据管道，遇到无效输入应立即 FAIL，而不是用占位数据继续。

**YAML 字段要在入口读取**：`notebook_id` 在 YAML 里配置了但在创建时没读取，导致每次都需要手动传入。统一的原则：创建时就从配置读取所有必要参数。
