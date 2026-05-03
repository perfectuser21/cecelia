# 5/3 dev-task workflow prompt 漏 framing 修复 — Learning

## 现象

5/3 综合救火（PR #2735）合并后，6 个手动派的 P0 dev 任务子容器 exit=0 但 0 PR、全部 quarantine。
诊断显示 callback 已通（0 silent error），但 prompt 文件只有 11 行裸 description，无 /dev 框架。

## 根本原因

`dispatcher.js:582` 把所有 task_type='dev' 任务路由到 L2 LangGraph runtime
`runWorkflow('dev-task')` → `workflows/dev-task.graph.js:33`：
```js
prompt: state.task?.description || state.task?.title || '',
```

完全跳过 `executor.js preparePrompt`，spawn 拿到的 prompt 没经过 `${skill}\n\n${sysCtx}${prd}${learning}${retry}` 包装。
容器内 claude 看到的是用户 raw markdown，没有"/dev"指令，自然就 read-only 看完直接 exit 0。

Brain 自动派的任务（probe failure auto-fix）之所以"看起来工作"，是因为它们的 description 里**就是完整 PRD**
（含 `# PRD: Auto-Fix...\n## 来源 / ## 功能描述 / ## 成功标准`），claude 能从 PRD 结构推断要做啥。
但**没人教过用户 POST /tasks 时 description 必须自带 PRD 框架**——这是隐藏耦合。

## 下次预防

- [x] dev-task.graph.runAgentNode 调 preparePrompt 包装 prompt
- [x] preparePrompt 失败兜底 `/dev\n\n${description}`，不阻断派发
- [x] 测试覆盖：preparePrompt 被调 + spawn 收到 wrapped prompt + fallback 路径
- [ ] **后续**：harness-task.graph.js / harness-initiative.graph.js 也直接传 description（同类问题），但 harness 任务有自己的 prompt builder（_prepareSprintPrompt 等），所以可能不受影响——下次 audit 确认
- [ ] **后续**：写 decisions：所有 dispatch graph node 必须经 preparePrompt（统一 prompt 入口约定）

## 涉及文件

- `packages/brain/src/workflows/dev-task.graph.js`（核心修复）
- `packages/brain/src/workflows/__tests__/dev-task-graph.test.js`（测试更新 + 加 fallback）
