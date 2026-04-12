### 根本原因

Brain 循环派发 harness_fix 任务（R8、R13、R41、R42...），但功能 PR #2282 早已合并。
每轮无对应 FAIL 文件，因为 Evaluator 已验证通过，Brain 却未停止循环调度。

### 下次预防

- [ ] Brain 在 harness_fix 任务派发前，检查对应 sprint 是否已有 PASS eval-round 文件
- [ ] 若 eval-round-N.md 显示 PASS，Brain 不应再派发同 sprint 的 harness_fix 任务
- [ ] psql RETURNING id 结果含换行符，变量赋值后用 `tr -d '\n'` 清理再用于 DELETE
