# Learning: content-pipeline Brain 内部编排

**Branch**: cp-03182017-content-pipeline-orchestrate
**Date**: 2026-03-18

## 实现了什么

在 Brain 层实现 content-pipeline 状态机编排。当 `content-pipeline` 任务进入 `queued` 状态时，Brain 自动拆分为 4 个串联子任务并依序推进：

```
content-pipeline(queued)
  → tick: 创建 content-research(queued) + pipeline → in_progress
  → execution callback: research 完成 → 创建 content-generate
  → execution callback: generate 完成 → 创建 content-review
  → execution callback: review PASS → 创建 content-export
  → execution callback: export 完成 → pipeline → completed
  [review FAIL: retry_count < 3 → 重建 content-generate，retry_count+1]
  [review FAIL: retry_count >= 3 → pipeline → failed]
```

## 根本原因（此次设计决策）

content-pipeline 编排选择在 Brain 层（tick + execution callback）内部实现，而不是派发给外部 agent。原因：
- 子任务间有状态依赖（前一步产出作为下一步输入），适合 Brain 作为状态机协调者
- 与已有的 decomposition-checker（tick 侧）、initiative_verify（execution 侧）模式完全一致
- 幂等检查（SQL 查重）防止 tick 多次触发时创建重复子任务

## 下次预防

- [ ] Worktree 路径陷阱：context 恢复时 worktree 可能已被清理，Edit/Write 到不存在路径会返回"成功"但实际无效。应先确认 `git worktree list` 再操作
- [ ] rebase 时机：功能分支落后 main 时需先 `git rebase main`，否则缺少依赖的 task_type 注册
- [ ] execution.js 中 `findingsValue` 变量名已定义在文件作用域，直接引用即可，不要用 `findings_value`
