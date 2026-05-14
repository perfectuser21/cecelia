# B38: runSubTaskNode 未将修正后的 sprintDir 注入子任务 payload

**分支**: cp-05141708-b38-subtask-sprint-dir
**发现时间**: 2026-05-14（W49 B37 验证 GAN 通过后）

### 根本原因

B37（`parsePrdNode` git diff 找 sprint 目录）修正了 `state.sprintDir`，但 `runSubTaskNode` 构建
`taskForGraph` 时用 `...subTask.payload` 展开原始 payload（含未修正的 `sprint_dir: 'sprints'`），
没有再用 `state.sprintDir` 覆盖。

generator `spawnNode` 读 `task.payload.sprint_dir || 'sprints'` 作为容器 `SPRINT_DIR` env，
因此始终拿到 `'sprints'`（顶级目录），写文件到错误位置。

B35/B36/B37 修的是"往 state 里放正确值"，B38 修的是"把 state 里的正确值传给子任务"。

### 下次预防

- [ ] 修复 sprint_dir 传递链时，必须逐节点追踪：`parsePrdNode → state.sprintDir → runSubTaskNode → taskForGraph.payload.sprint_dir → spawnNode → SPRINT_DIR env`。
  每次修一节就跑一次 E2E 日志验证，不要等全链路跑完才发现下一节断了。
- [ ] 新增类似 payload 透传的 node 时，显式检查 state 中是否有需要覆盖 payload 原值的字段。
- [ ] `harness-initiative-b38.test.js` 的测试模式（mock compiledGraph.invoke 捕获 task 参数，断言 payload 字段）
  适用于所有需要验证"state → taskForGraph 注入"行为的场景，复用此模式。
