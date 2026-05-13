# Learning — B21 mergePrNode 不真合 PR

### 根本原因
`harness-task.graph.js` 的 `mergePrNode` 节点在 evaluator PASS 后被 route 进入，
但函数体仅调 `executeMerge(state.pr_url)` —— 而 `executeMerge` 走的是 `gh pr merge --squash`
**同步阻塞 + 不带 --auto**：

1. 没 `--auto` 意味着不等 CI required check，依赖外层 shepherd 走另一条路径；
2. 实际 graph 内大量情况只是"看起来调了 merge"但容易因为同步异常被 swallow；
3. Cecelia "24h 自主跑任务" 模式必须 brain **节点自身**真合 PR 不依赖外层守护进程，
   否则 PR 永远 OPEN，要么靠人工 merge button 要么靠 shepherd 半小时一轮回扫。

### 下次预防
- [ ] Brain graph 节点必须真执行业务（不能只 return placeholder 或委托给外层 shepherd）
- [ ] auto-merge 用 `gh pr merge --auto --squash --delete-branch`：
      `--auto` 等所有 required check pass 再合，**不强 admin bypass**；
      `--delete-branch` 合完自动清 head branch；
- [ ] merge 失败**不 throw 不 set state.error**：避免 graph 走错误通道触发重试导致
      重复 merge 风险。改用 `merge_error` 软字段让 graph 安全退 END，由人工或
      shepherd 二次补救；
- [ ] 同步更新对应单测 + 集成 e2e：mock `node:child_process.execFile` 而不是
      mock 已废弃的 `shepherd.executeMerge`。
