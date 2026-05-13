# Learning — B17 final_evaluate 漏 PR_BRANCH 让 walking skeleton P1 自动收尾死循环

### 根本原因

B14 给 sub-task evaluate_contract node 加了 PR_BRANCH env 但漏掉 initiative 级 finalEvaluateDispatchNode。final_evaluate 跑 initiative worktree (base=main) 看不到 generator 在 PR 分支写的代码 → 永远 Step §1 happy schema FAIL → task.status='failed'。设计意图 final_evaluate 跑 merge 后 main，但实际 sub-task evaluate_contract FAIL → 没 merge_pr → final_evaluate 跑还没 merge 的 main → 必 FAIL。W36/W37/W38 三次都断在这里。

### 下次预防

- [ ] 加 evaluator 类节点必须 grep 全 graph 看几处 spawn 用 evaluator skill，每处 env 都要传 PR_URL + PR_BRANCH（B14 漏一处，B17 补一处）
- [ ] 任何"主图 + 子图"架构修 spawn env 时，两层都得改；只改子图等于半 fix
- [ ] grep '"PR_URL"\|PR_BRANCH"\s*:' brain src/workflows 应该至少 2 处 hit（task graph + initiative graph）
- [ ] final E2E evaluator 在 walking skeleton 阶段（PR 没合 main 之前）应支持 PR 分支 mode，不能写死 main
