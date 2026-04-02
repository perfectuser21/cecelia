## Engine 清理：旧 gate 验证代码删除（2026-04-02）

### 根本原因

slim-engine-heartbeat 重构（PR #1784-#1787）删除了 Planner/Generator/Evaluator subagent、Sprint Contract Gate、LITE/FULL 路径，但 verify-step.sh step1 保留了 ~150 行对这些已删功能的 seal 文件检查，bash-guard.sh 保留了 Rule 5b（检查 spec_review_status/code_review_gate_status），3 个测试文件测试已删脚本。根本原因是"功能删了，验证代码没跟着删"。

### 下次预防

- [ ] 删除功能时，同步检查 verify-step.sh 是否有对应 gate seal 检查需要删除
- [ ] 删除功能时，检查 bash-guard.sh 是否有对应规则需要删除
- [ ] 删除脚本时，同步删除 tests/dev/ 和 tests/validation-loop/ 下的对应测试文件
- [ ] 每次重构后运行 `npx vitest run tests/hooks/` 确认无僵尸测试失败
