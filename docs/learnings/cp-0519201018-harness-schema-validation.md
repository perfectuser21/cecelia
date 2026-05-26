## harness schema validation — Reviewer/Evaluator Zod structured output（2026-05-19）

### 根本原因

LLM 输出不完整 `.brain-result.json`（缺少 rubric 维度字段）时，`readBrainResult` 只校验字段存在性，不校验深层结构。`computeVerdictFromRubric` 收到 null 维度后返回 null verdict，GAN 回退到 LLM 文本判断，收敛失败。此外 `\bschema\b` 无法匹配 `schema_mismatch`（下划线是 word character，无 word boundary），导致 schema_mismatch 错误被 LLM_RETRY 误捕获。

### 下次预防

- [ ] 新增 LLM 输出读取点时，必须用 Zod schema 深度校验，不能只用字段存在性检查
- [ ] 向 PERMANENT_ERROR_RE 添加新错误码前，先用 `\b` + JS regex 验证 word boundary 是否正确匹配含下划线的字符串
- [ ] Reviewer 节点：schema 不合格 → while(true) 重试（不 throw），唯一终止条件是 budget
- [ ] Evaluator 节点：schema 不合格 → throw schema_mismatch + catch 块重新抛出（不被 fallback 吞掉）
- [ ] 多次重试的 cost_usd 应累加返回，而非只返回最后一次的 cost
