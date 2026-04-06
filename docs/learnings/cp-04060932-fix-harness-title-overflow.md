# Learning: Harness 标题链 varchar(255) Overflow

## 根本原因

Harness v2.0 中每个任务标题都拼接父任务标题：
```
[Evaluator] 重测 Sprint R4 — [Fix] Sprint 修复 R4 — [Evaluator] 重测 Sprint R3 — ...
```
经过 4 个 Fix/Evaluate 轮次后，标题链超过 varchar(255) 限制（275字符），
`createHarnessTask()` 抛出 PostgreSQL overflow 错误。
该错误被外层 `try...catch (harnessErr)` 以 non-fatal 方式吞掉，
sprint_evaluate R4 从未被创建，pipeline 静默停止。

## 下次预防

- [ ] Harness 任务标题不能累积父链 —— 应使用 `sprint_dir + round` 短格式
- [ ] `createHarnessTask` 失败时应记录 P0 告警，不能仅 console.error
- [ ] 所有生成标题的代码路径需加 `title.length <= 255` 断言检查

## 修复方式

将所有 `— ${harnessTask.title}` 累积模式替换为固定格式：
- `[Evaluator] sprint-N RX`
- `[Fix] sprint-N RX`
- `[Contract] sprint-N PX`
- `[Contract Review] sprint-N RX`
- `[Generator] sprint-N 写代码`
