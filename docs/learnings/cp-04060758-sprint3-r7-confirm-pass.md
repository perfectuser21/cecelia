# Learning: Sprint 3 R7 — Evaluator result 空对象触发误判循环

## 根本原因

Evaluator 会话结束时，Step 6（回调 Brain）写入 `result: {}`（空对象）而非 `{"verdict":"PASS"}`。
`execution.js` 处理逻辑：`const verdict = resultObj.verdict || 'FAIL'` → 空对象没有 `verdict` 字段 → 默认 `FAIL` → 触发 `sprint_fix`。

这导致 Sprint 3 出现 R4→R5→R6→R7 的误判修复循环，每轮评估结论均为 PASS，但 Brain 持续误判。

## 下次预防

- [ ] execution.js 中，`sprint_evaluate` 结果为 `{}` 时，应识别为"Evaluator 回调不完整"而非"FAIL"
- [ ] 应走 `result=null` 的重试路径（sprint_evaluate retry），而不是创建 sprint_fix
- [ ] Evaluator SKILL.md Step 6 应加强：必须在 curl PATCH 成功后才 exit，否则 retry 3 次
- [ ] evaluation.md 写入后立即 push（已在 v1.1.0 实现）是必要但不充分条件；result 回写同样关键
