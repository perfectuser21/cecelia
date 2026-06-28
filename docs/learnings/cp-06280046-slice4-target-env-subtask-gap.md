# Learning: Slice4 透传 gap — target_environment 没到 sub-task state

> 2026-06-28 · Slice7 真 run 2937fd5e 暴露 · PR cp-06280046-target-env-subtask

## 背景
9-slice 全部合并 + Brain 1.231.5 部署后,点火 Slice7 北极星验证 run(Dashboard 首页状态标识)。
run 跑通 planner → GAN(4轮) → generator **写代码+commit+建 PR #3460 成功**,但**卡在 generator
容器不退出**(callback 不发 → await_callback 死等),北极星三件套未达。

## 根本原因（Slice4 没真生效）
Slice4 给 `spawnNode` 加了 `if (extractTargetEnv(state)==='mac_web') executeOnHost` host 逃逸,
但 `runSubTaskNode`（harness-initiative.graph）invoke generator sub-graph 时,`taskForGraph.payload`
透传了 machine/executor/sprint_dir/logical_task_id,**唯独漏了 target_environment**。

→ sub-graph 的 `extractTargetEnv(state)` 拿不到 mac_web（state.task.payload 无 + state.prdContent
planner PRD 无 `## target_environment:` 头）→ 默认 `local_api` → generator spawnNode 走 docker。

→ generator 在无浏览器 docker 容器跑 mac_web 的 Playwright 自验 → 卡死容器不退出。**这正是
Slice4 要解决的场景,但透传 gap 让 host 逃逸分支永不触发**。

## 修复
`runSubTaskNode` 的 `taskForGraph.payload` 加一行透传：
`...(state.task?.payload?.target_environment ? { target_environment: ... } : {})`
一处修复同时覆盖 generator `spawnNode` + `evaluate_contract`（两节点都在 sub-graph 内共用 extractTargetEnv）。

## 非显然点 / 下次预防
- **加了执行分支 ≠ 分支会被触发**：Slice4 单测全绿（注入 prdContent='## target_environment: mac_web'），
  但真 run 的 sub-task state 根本没这个值。**单测验证逻辑,真 run 验证接线（数据是否真到达）**——
  这就是 Slice7 点火验证的核心价值,没有它 Slice4 的 gap 不会暴露。
- [ ] 新增依赖某 state 字段的执行分支 → 必须追该字段在真实调用链（尤其 graph→sub-graph invoke 边界）
      是否真透传,不能只靠单测注入。
- [ ] sub-graph invoke 的 payload 透传是个反复漏点（已漏过 sprint_dir/B38、machine/executor,现在
      target_environment）→ 考虑后续把 initiative→sub-task 的透传字段集中成 SSOT helper,避免逐个漏。
- [ ] **遗留待查**：generator 容器创建 PR 后不退出（callback 不发）—— 即使走 host,容器/agent 退出
      与 callback 机制仍需单独验证（本次只修了走 docker 的根因）。

## regression 守卫
`runSubTaskNode-payload.test.js` 加源码断言（taskForGraph.payload 含 target_environment 透传），留 CI。
