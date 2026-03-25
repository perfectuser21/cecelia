# Learning: Rumination fallback 注入 synthesis_archive 历史反刍上下文

**Branch**: cp-03242138-2083997e-ba96-456a-913a-fb7dfb
**Date**: 2026-03-25

## 问题

`rumination.js:digestLearnings` 在 NotebookLM 不可用时 fallback 到 `callLLM`，传入空 `notebookContext`（`buildRuminationPrompt(learnings, memoryBlock, "")`）。LLM 看不到历史反刍洞察，产生重复/浅层洞察。

### 根本原因

NotebookLM 主路负责全量历史综合（`queryNotebook`），fallback 路只有 `memoryBlock`（近期记忆），完全缺少历史洞察积累。`synthesis_archive` 表每天存储 daily 级别的反刍洞察，是现成的历史上下文来源，但 fallback 路径没有查询它。

## 修复

- `buildRuminationPrompt` 第三参数注入标题从 `"NotebookLM 补充知识"` 改为 `"历史反刍上下文"`
- `digestLearnings` fallback 路径：从 `synthesis_archive` 查最近 7 天 `level='daily'` 洞察，构建 `fallbackContext`，传入 `buildRuminationPrompt`
- `synthesis_archive` 查询失败时静默降级（不影响主流程）

## 下次预防

- [ ] NotebookLM 主路 + callLLM fallback 的对称性检查：两路使用的上下文信息量是否相当
- [ ] fallback 路径新增 `db.query` 时，必须同步更新测试 mock 链（`mockQuery.mockResolvedValueOnce` 的顺序必须与代码执行顺序完全一致）
- [ ] 历史上下文来源优先级：synthesis_archive（反刍洞察）> memory_stream（近期记忆）> 空
