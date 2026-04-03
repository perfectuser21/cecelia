# Learning: 重构 executeResearch（圈复杂度 27 → ~5）

## 任务
分支: cp-04030357-e3496a60-5255-48c0-aa29-c26635
日期: 2026-04-03

### 根本原因
`executeResearch` 函数圈复杂度高达 27，主要原因：
1. **重复逻辑**：清空 NotebookLM sources 的逻辑出现两次（前置清空 + 后置清空）
2. **混杂职责**：prompt 构建、JSON 解析、findings 提取全部内嵌在主流程中
3. **深层嵌套**：try/catch + for 循环 + 内层 try/catch 形成三层嵌套

### 解决方案
提取三个辅助函数：
- `clearNotebookSources(notebookId, label)` — 封装重复的 source 清空逻辑
- `buildResearchPrompt(typeConfig, keyword)` — 封装 prompt 构建（带 fallback）
- `parseResearchFindings(raw, keyword)` — 封装 JSON 解析和 findings 提取

重构后 `executeResearch` 主体圈复杂度降至 ~5（只剩 4 个分支点）。

### 下次预防
- [ ] 同一逻辑块出现 ≥2 次时立即提取为函数
- [ ] 函数超过 60 行时检查是否有可提取的子职责
- [ ] try/catch 嵌套超过 2 层时用辅助函数封装内层
