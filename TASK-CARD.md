# B38: runSubTaskNode 正确注入 sprintDir 到子任务 payload

**类型**: fix
**范围**: `packages/brain/src/workflows/harness-initiative.graph.js`

## 问题根因

`parsePrdNode`（B37）修正后的 `state.sprintDir`（如 `sprints/w49-b37-validation`）从未传递给 generator 容器。
`runSubTaskNode` 构建 `taskForGraph` 时展开 `subTask.payload`（含原始 `sprint_dir: 'sprints'`），但未用
`state.sprintDir` 覆盖，导致 generator `spawnNode` 读到 `SPRINT_DIR=sprints`（顶级目录），写文件到错误位置。

## 修复

在 `taskForGraph.payload` 中追加 `...(state.sprintDir ? { sprint_dir: state.sprintDir } : {})`，
确保 B37 修正值流向 generator `SPRINT_DIR` env var。

## DoD

- [x] [ARTIFACT] `harness-initiative.graph.js` 含 `state.sprintDir ? { sprint_dir: state.sprintDir }` 注入逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('state.sprintDir ? { sprint_dir: state.sprintDir }'))process.exit(1)"

- [x] [BEHAVIOR] `runSubTaskNode` 使用 `state.sprintDir` 覆盖 `subTask.payload.sprint_dir`（B37 修正值传到 generator）
  Test: packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js

- [x] [BEHAVIOR] `state.sprintDir` 为 null 时保留 `subTask.payload.sprint_dir` 原值（无副作用）
  Test: packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js

- [x] [BEHAVIOR] `logical_task_id` 注入行为不受 B38 影响（向后兼容）
  Test: packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js
