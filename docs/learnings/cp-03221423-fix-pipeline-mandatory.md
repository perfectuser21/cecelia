## 修复 /dev pipeline 强制机制（2026-03-22）

### 根本原因

原 pipeline 设计存在三处违反"100%自动原则"的逻辑：
1. `retry_count >= 3 → blocked` 在 spec_review 和 code_review_gate 中强制等人工，违背自动化原则
2. Simplify 章节放在 Stage 4（CI 之后），而实际应在 push 之前（Stage 2 code-review-gate 已包含 C/D/E 维度），导致重复且时机错误
3. 没有强制垃圾清理机制，AI 写代码容易只加不删

### 下次预防

- [ ] 任何涉及"等人工"/"blocked"的设计，在 Task Card 阶段就要 flag 为违反 100% 自动原则
- [ ] Simplify/垃圾清理类步骤必须在 push 前（Stage 2），不能放 Stage 4
- [ ] DoD Test 字段的负向检查（验证某文字已删除）应验证整个文件，包含 changelog 条目也可能触发误判
