## mergePrNode branch-behind 静默失败修复（2026-05-20）

### 根本原因

`mergePrNode` catch 块将 `gh pr merge` 失败写入 `merge_error` 字段而非 `state.error`，导致：
1. 任务状态走 END 时仍是 queued 而非 failed
2. initiative 图无法识别失败（只检查 `state.error`）
3. "branch behind main" 场景完全没有恢复路径，子任务永远卡在 queued

### 下次预防

- [ ] 所有 LangGraph 节点的失败路径必须写 `{ error: { node, message } }`，禁止用其他字段名
- [ ] 新增节点时，检查 initiative graph 如何判断子任务成功/失败，确保错误字段名一致
- [ ] "分支落后"类的瞬态错误必须有明确恢复路径（rebase + re-poll），不能直接报 FAIL
- [ ] TDD 覆盖所有 catch 分支，特别是 update-branch 失败 + rebase_attempted 二次失败场景
