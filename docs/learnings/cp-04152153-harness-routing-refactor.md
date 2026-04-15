# Learning: harness routing 从 routes/execution.js 抽取到 harness-router.js

## 背景

Cecelia Brain 引入 callback_queue 架构后，bridge 写 callback_queue，
callback-worker 消费队列并调用 `callback-processor.processExecutionCallback`
完成状态更新。HTTP `/execution-callback` 端点保留了所有下游业务逻辑
（包括 Harness v4.0+ 的 Layer 1-4 路由：planner → propose → review → generate
→ fix → evaluate → report），没有迁移到共享处理器。

## 症状

通过 callback_queue 进来的 callback（worker 路径）从不触发 harness 路由，
pipeline 在 Layer 1/2/3 任意环节卡死——任务标记为 completed 但下一级任务
永远不被创建。

## 根本原因

callback_queue 架构的完整性依赖 callback-processor 包含所有下游路由逻辑。
HTTP 端点和队列 worker 必须走同一条逻辑，否则写入路径和处理路径一分为二，
重要的下游动作（派生任务、合并 PR、部署、生成报告）只会在其中一条路径上
发生。原实现把 harness 路由放在 routes/execution.js 的 HTTP handler 内部
闭包里（约 984 行代码，包括 checkPrCiStatus / extractVerdictFromResult /
extractBranchFromResult / persistHarnessVerdict 等辅助函数），callback-
processor 完全无法复用。

## 修复

1. 新建 `packages/brain/src/harness-router.js`，导出 `processHarnessRouting`
   函数，把 Layer 1-4 所有 `if (harnessType === 'harness_XXX')` 分支、辅助
   函数、fallback 逻辑（pr_url 多层提取、planner_branch git 分支匹配、
   verdict timeout parse 等）原样迁移过来。
2. `callback-processor.processExecutionCallback` 在 status update 结束后
   查询 task_type，如以 `harness_` 开头则动态 import `harness-router.js`
   并调用 `processHarnessRouting`。
3. `routes/execution.js` 的 HTTP 端点删除 984 行内联 harness 路由，改为
   委托调用同一个 `processHarnessRouting`，接口保持不变。

## 下次预防

- [ ] 新增"下游路由"类逻辑时，必须放在共享模块（callback-processor 或类似
      处理器），HTTP 端点只做"入口+持久化+委托"，不能写业务分支。
- [ ] PR review 要检查：新增的 callback 处理逻辑是否同时覆盖 HTTP 路径和
      worker 路径？如果只在 HTTP handler 里，会导致 callback_queue 消费时
      下游动作丢失。
- [ ] Brain 任何"任务完成 → 派生下游任务"的规则，必须在
      callback-processor 的 downstream-triggers 区段集中管理；不得在
      routes 层散落。
- [ ] 重构时配合 `node --check` + ESLint + brace balance 三把尺子，避免
      迁移代码产生隐性的作用域/括号错误。

## 影响范围

- `packages/brain/src/harness-router.js`（新增，~870 行）
- `packages/brain/src/callback-processor.js`（新增 35 行委托调用）
- `packages/brain/src/routes/execution.js`（删除 984 行，插入 32 行委托调用）
- 行为变更：原本只在 HTTP 路径触发的 harness 路由，现在 callback_queue
  worker 路径也会触发——修复了通过队列来的 callback 卡死 pipeline 的问题。
