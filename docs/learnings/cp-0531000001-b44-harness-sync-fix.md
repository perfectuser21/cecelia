# B44 — GAN async 回退：propose_branch 丢失导致 pipeline 全卡

### 根本原因

WS3 将 GAN proposer/reviewer 改为 `spawnDockerDetached + interrupt`（异步）后，
`runGanContractGraph` 在第一次 interrupt 就立即 return `{kickoff: true}`，
不等 GAN 完成。下游 `inferTaskPlanNode` 从 `ganResult.propose_branch` 读取
（此时为 undefined/null），`fetchAndShowOriginFile` 找不到 propose_branch，
`upsertTaskPlan(null)` 抛错，所有 initiative 任务失败。

### 根本设计问题

WS3 设计假设 Brain 可以通过 callback resume 推进 GAN，但这要求：
1. Docker 容器调 `/api/brain/harness/callback/${containerId}`
2. `harness-thread-lookup.js` 能找到对应 graph 和 threadId
3. `harness-initiative` graph 在 thread_lookup 能映射到正确的图（compileHarnessFullGraph）

这三个假设在当前 Brain 版本都未完全打通（callback URL 注入、graph cache、
compileHarnessInitiativeGraph vs compileHarnessFullGraph 混用）。

### 三处修复

1. **harness-gan.graph.js**: proposer/reviewer 改回阻塞 executor，runGanContractGraph 同步等 finalState
2. **harness-thread-lookup.js**: harness-initiative case 改用 compileHarnessFullGraph
3. **harness-initiative.graph.js**: runPlannerNode prompt 删除矛盾的 task-plan.json 输出要求

### 下次预防

- [ ] 在修改同步→异步时，必须同时验证 `ganResult.propose_branch` 非空（集成测试）
- [ ] WS3 类异步改造，必须同时更新 `harness-thread-lookup.js` 的 dispatch case
- [ ] 异步节点的 callback URL 必须在真实 Docker 环境 smoke test 验证
- [ ] `runGanContractGraph` 的返回形状变更必须有专项测试覆盖（propose_branch 字段）
