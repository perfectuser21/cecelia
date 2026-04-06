### 根本原因

Sprint 3 R5 Evaluator 任务（212fe045）在第 1 次执行时被 watchdog kill（pressure=1.02），
第 2 次执行成功写出 evaluation.md（verdict: PASS），但 Brain 任务的 `result` 字段为 null，
导致 Brain 认为 Evaluator 未返回 verdict，触发了 R6 sprint_fix。

实际代码已完全正确，R4/R5 均独立验证 PASS，R6 为误触发的保底修复。

### 下次预防

- [ ] Evaluator Stop Hook 必须在退出前验证 Brain 任务的 result 字段已写入（curl GET 确认）
- [ ] 若 result 为 null 且 evaluation.md verdict 存在，应自动 PATCH 回写
- [ ] watchdog kill 后重试时，需校验上次执行是否已写入 result，避免重复触发 sprint_fix
- [ ] Brain execution callback 处理 sprint_evaluate 时，若 result 为 null 但 evaluation.md 存在且含 PASS，应自动读取而非触发 sprint_fix
