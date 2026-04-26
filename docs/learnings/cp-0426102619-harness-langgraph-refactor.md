# Learning: Phase B/C 全程 LangGraph 重构

Sprint 1 / Brain task 5616cc28-28c8-4896-b57e-ee9fcc413e86
Branch: cp-0426102619-harness-langgraph-refactor

## 关键决策

1. **Send API 用法**：LangGraph 1.x 的 `Send('node_name', args)` **必须作为 conditional edge 的路由函数返回值**，不能从 graph node 直接 return。
   - 错误：`addEdge('fanout', 'run_sub_task') + fanout return Send[]` → InvalidUpdateError
   - 正确：`addNode('fanout', passthrough) + addConditionalEdges('fanout', fanoutSubTasksNode, [...])` 路由函数返回 Send[]
   - 路由函数也可以返回字符串 `['join']` 直接跳到 join（空 fanout case）

2. **Sub-graph 嵌入**：用 `_buildTaskGraph().compile()` 缓存 + `compiled.invoke()` per sub-task，thread_id `harness-task:${initiativeId}:${subTaskId}` 让每 sub-task 有独立 checkpoint。LangGraph subgraph 不直接支持原生嵌入到 fanout，所以包一层 `runSubTaskNode`。

3. **同步 setTimeout 替代 interrupt**：第一版 `pollCiNode` 用 `await setTimeout(90s)`，单 sub-task 最多阻塞 30 min。FUTURE 改 LangGraph interrupt + 外部 trigger 续跑。env override `HARNESS_POLL_INTERVAL_MS=0` 加速测试。

4. **env flag 兜底**：`HARNESS_USE_FULL_GRAPH=false` 走老路 1 周。executor.js 同时保留两条路径，PRD 给定的失败回退方案。`HARNESS_USE_FULL_GRAPH=true`（default）下 4 个 retired task_type 自动标 `pipeline_terminal_failure` 防老数据复活。

5. **保留兜底而非物理删**：harness-task-dispatch.js / harness-watcher.js / harness-phase-advancer.js / harness-final-e2e.runFinalE2E / harness-initiative-runner.runPhaseCIfReady — 这些被 executor.js / harness-initiative-runner-phase-c.test.js / harness-final-e2e.test.js 引用。物理删会破老路 + 测试。改成 deprecation stub（25 行兜底空实现）+ @deprecated comment，1 周后下个 PR 再删。

6. **shepherd 加 SQL filter**：`AND COALESCE(payload->>'harness_mode', 'false') NOT IN ('true', 't')` 排除 harness PR，让 sub-graph merge_pr node 独占 merge 路径。

## 根本原因（为什么之前 procedural）

- harness 早期没 LangGraph 基建（Phase A 是后来 C8a 落地）
- shepherd 与 watcher 重复 CI 轮询，状态机错位（merge 责任不清）
- task_type 增长（harness_task / harness_ci_watch / harness_fix / harness_final_e2e）使 Brain task 表膨胀

合并到一个 graph 后：
- state 全程贯穿，PostgresSaver checkpoint 替代 task 表 + initiative_runs.phase 双重存储
- 砍 6 procedural module（净减 ~440 行）+ retire 4 task_type
- shepherd 加 SQL filter → 唯一 merge 路径在 sub-graph

## 踩坑

1. **vitest mock 顶层变量**：`const mockPool = {...}; vi.mock('../db.js', () => ({ default: mockPool }))` 报 "Cannot access mockPool before initialization"。解决：`vi.hoisted(() => ({...}))` 包装 mocks。

2. **worktree 被外部并行 agent 清理**：开发途中 worktree dir 突然消失（另一个并行 agent cleanup）。导致 1 commit 修改丢失，必须 `git worktree add` 重建 + 重装 npm + 重做修改。Lesson：每个 Task 完成立刻 commit，避免长时间在工作区累积未 commit 修改。

3. **rebase 修复 facts-check**：worktree 落后 main 后 facts-check 不过（main 有 tick.js 重构 #2633/#2638）。`git rebase main` 干净 cherry-pick 10 commit 解决。

## 下次预防

- [ ] LangGraph 节点设计第一原则：每节点首句加幂等门 (state.X_done? return)
- [ ] Send API fanout 必须用 conditional edge router，不要从 graph node 直接 return
- [ ] 长循环节点（poll_ci）的 sleep 用 env override（HARNESS_POLL_INTERVAL_MS=0）以便测试加速
- [ ] env flag 双轨期 ≤2 周，到期立删避免长期维护两套代码
- [ ] **每完成一个 commit 立刻 `git add + commit`**，避免 worktree 被外部清理时丢工作
- [ ] 保留 deprecated 函数 1 周作回退兜底，不要急着物理删 — 老 caller 可能藏在 `await import()` 里 grep 不到
