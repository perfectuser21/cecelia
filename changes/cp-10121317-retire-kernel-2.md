## Brain {VERSION} — 删除失去消费者的 kernel 恢复与执行辅助模块（A5-2）

- A5-1 撤掉启动与恢复分支后，删除无生产引用的 attempt-resource-cleanup / attempt-resource-replacement、commander-invoker、旧 execution-transport router、git-branch-head-resolver 及专属测试和 smoke。
- 共享 PG 回归保留现役 createAttemptStore 的授权重验、撤销拒绝、父预约保持与加权容量合同；清除已退役恢复 helper 的 mock。
- Fleet、attempt-run、one-session-merge 仍引用 run.js/buildRealDeps，继续保留这些共享模块、activity-runtime、consciousness、golden_path_proposal 及有头收账。不更改 DB schema。任务 15fd4896-9b3a-4854-8631-811c3e24023f。
