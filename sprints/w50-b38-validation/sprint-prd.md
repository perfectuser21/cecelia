# Sprint PRD — B38 验证：runSubTaskNode SPRINT_DIR 注入修正

## OKR 对齐

- **对应 KR**：Harness 全链路修复（B34-B38）
- **当前进度**：修复已合并（Brain v1.230.7）
- **本次推进预期**：验证 B38 修复可观测通过（测试绿灯）

## 背景

B38 根因：`runSubTaskNode` 向子任务注入的 `task.payload.sprint_dir` 使用的是原始 payload 顶级值（如 `"sprints"`），而非 B37 通过 git diff 修正后的 `state.sprintDir`（如 `"sprints/w50-xxx"`）。Generator spawnNode 读取该值作为 `SPRINT_DIR` 环境变量，导致文件写到顶级 `sprints/` 而非正确子目录。

Brain v1.230.7 已在 `runSubTaskNode` 第 1062 行加入覆盖逻辑（`state.sprintDir ? { sprint_dir: state.sprintDir } : {}`）。本 sprint 目标是让此修复可被测试验证。

## Golden Path（核心场景）

运行 B38 测试套件 → 测试可解析并执行 → `runSubTaskNode` 注入正确 `sprint_dir` 断言通过

具体：
1. [触发] 执行 `npx vitest run harness-initiative-b38.test.js`
2. [系统处理] 测试中 `runSubTaskNode` 以 `state.sprintDir='sprints/w49-b37-validation'` 调用，子任务原始 `payload.sprint_dir='sprints'`
3. [可观测结果] generator 收到 `task.payload.sprint_dir='sprints/w49-b37-validation'`，断言通过；fallback 用例（`state.sprintDir=null`）保持原值 `'sprints/w50-fallback'`

## Response Schema

N/A — 任务无 HTTP 响应（纯 Brain 内部测试验证）

## 边界情况

- `state.sprintDir` 为 `null` 时：不覆盖 `subTask.payload.sprint_dir`（保持原值）
- `state.sprintDir` 非空时：强制覆盖，即使原值已有子目录路径
- B37/B35/B36 测试同样受 `@langchain/langgraph` 缺失影响，同批修复

## 范围限定

**在范围内**：
- 为 `harness-initiative-b38.test.js` 加 `@langchain/langgraph` 的 `vi.mock`，使测试可解析
- 同步修复 `harness-initiative-b37.test.js`、`b36`、`b35` 同类缺失（避免批量失败）
- 运行修复后测试，确认 3 个用例全通过

**不在范围内**：
- 安装或升级 `@langchain/langgraph` npm 包
- 修改 `harness-initiative.graph.js` 实现逻辑
- 修改任何非测试文件

## 假设

- [ASSUMPTION: `@langchain/langgraph` 在 vitest ESM 环境下需要显式 `vi.mock` 以绕过缺失包]
- [ASSUMPTION: B34/B38 其余相关测试文件（b35/b36/b37）存在同类根因]

## 预期受影响文件

- `packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js`：加 `vi.mock('@langchain/langgraph')`
- `packages/brain/src/workflows/__tests__/harness-initiative-b37.test.js`：同上
- `packages/brain/src/workflows/__tests__/harness-initiative-b36.test.js`：同上
- `packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js`：同上

## journey_type: autonomous
## journey_type_reason: Brain 内部调度逻辑单元测试验证，无 UI 交互，无 HTTP endpoint
