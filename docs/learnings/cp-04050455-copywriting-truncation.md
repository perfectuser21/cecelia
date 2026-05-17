# Learning: _buildCopywritingPrompt 素材截断导致 copy-review 死循环

**分支**: cp-04050455-88c13be1-8869-478e-b4b0-939dd0  
**日期**: 2026-04-05

### 根本原因

`_buildCopywritingPrompt` 将每条 research finding 截断到 200 字符：
```js
// 错误：截断过短
`${i + 1}. ${f.title}: ${(f.content || '').substring(0, 200)}`
```
NotebookLM 产出内容通常 2000-3500 字符，截断发生在句子中间。LLM 收到不完整素材后，
回复"请提供完整调研素材"而非生成内容。copy-review 检查到 quality_score < 6 → FAIL，
重试 3 次 → `MAX_REVIEW_RETRY` 触发 → pipeline 终止。

**症状**：所有 pipeline 在 copy-review 阶段终止（重试达上限 3 次），每次重试行为完全相同。

### 修复
将截断限制从 200 提升到 1500：
- 1 条 finding × 1500 字符 ≈ 500 tokens，7 条 × 1500 = 10500 字符 ≈ 3500 tokens，在 maxTokens: 4096 内安全
- LLM 能看到完整案例描述，正常生成内容

### 下次预防

- [ ] 写 LLM prompt 时，检查素材截断长度是否足够（不要默认 200 字符）
- [ ] 当 pipeline 出现"copy-review 重试达上限"时，第一步检查生成内容是否为元评论（"请提供完整素材"）
- [ ] 新增截断测试：mock finding with 2000+ chars，assert prompt contains 1500+ chars
