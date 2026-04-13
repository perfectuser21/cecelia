### 根本原因

Brain 在 Evaluator R3 任务完成前（result 回写前）即派发了 harness_fix 任务（24e4d67c），
导致 harness_fix 启动时 Evaluator 实际已 PASS，属于误报（与 R2 相同模式）。

Evaluator 任务 f57dc424 结果：verdict=PASS，三个 WS 全部验证通过。

### 下次预防

- [ ] Brain execution.js：harness_fix 派发应等待 Evaluator task completed + result.verdict 确认为 FAIL 后再触发
- [ ] 误报判断：harness_fix 任务启动时若 Evaluator task 已 PASS，应自动跳过并回写 completed
- [ ] eval-round-N.md 文档应在 Evaluator 任务完成时直接写到 sprint_dir（不只在 evaluator 分支）
