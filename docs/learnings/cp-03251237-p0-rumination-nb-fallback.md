# Learning: P0 修复 — Rumination NotebookLM fallback 丢上下文

**Branch**: cp-03251237-p0-rumination-nb-fallback
**PR**: TBD
**Date**: 2026-03-25

### 根本原因

`digestLearnings` 的 NotebookLM fallback 路径调用 `buildRuminationPrompt(learnings, memoryBlock, '')` 时传入空字符串作为第三参数（notebookContext）。函数内 `if (notebookContext)` 判断为 false，`## 历史反刍上下文` 区块完全不注入。LLM 只能看到当次 learnings 和短期记忆，无法访问历史反刍洞察，导致输出重复或浅层。

每次 NotebookLM 不可用（bridge 离线、超时、返回过短响应）时，这个退化都会静默发生——日志只显示 `notebooklm_primary failed, falling back to callLLM`，但 fallback 品质问题不被记录。

`synthesis_archive` 表记录了每次成功反刍的 daily 级别洞察，是本地可用的历史知识库，且已有完整的去重和写入保证，可作为 NotebookLM 不可用时的有效替代。

### 下次预防

- [ ] fallback 路径写入 non-blocking 日志时，同时记录 fallback 质量标记（`context_source: local_archive` vs `context_source: notebooklm`）以便监控 fallback 频率和质量差异
- [ ] 所有 "static empty string" 形式的默认参数（如 `fn(a, b, '')`）在代码评审时应标记为潜在退化点，检查是否应该查 DB 补充
- [ ] `synthesis_archive` 历史上下文的截断长度（300 chars/entry × 7 entries = 最多 ~2100 chars）需在未来根据 LLM token budget 动态调整
