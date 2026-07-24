# Red Evidence (commit 1) — task f90ddca3-396d-45b2-ad13-2dfbd9e15080

合同测试已随 contract import 存在于当前分支（relay 常态，永久池 tests/regression/relay-f90ddca3/），不重复 checkout。

`npx vitest run tests/regression/relay-f90ddca3/` 实跑结果（wrapper scripts/smoke/e2e/relay-f90ddca3.sh 尚未创建）：

```
failed=5 passed=0 total=5 (vitest --reporter=json 确定性统计)
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/Users/administrator/worktrees/task-f90ddca3/session-d8778eb4/scripts/smoke/e2e/relay-f90ddca3.sh' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯
 Test Files  1 failed (1)
      Tests  5 failed (5)
   Start at  08:11:54
   Duration  125ms (transform 11ms, setup 0ms, collect 9ms, tests 4ms, environment 0ms, prepare 36ms)
```
