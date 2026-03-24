# crystallize 执行闭环 — 3个断线修复

**Branch**: cp-03241404-crystallize-exec-wiring  
**Date**: 2026-03-24

## 变更内容

补全了 crystallize 任务类型端到端执行的3个断线。

## 根本原因

crystallize task_type 在 PR #1491 定义了 orchestrator 状态机，但没有同步对接执行层的3个关键钩子：

1. **playwright-runner.sh 没有回传**：Codex Playwright runner 执行完后直接 exit，Brain 不知道任务是否成功，`advanceCrystallizeStage` 永远不会被触发。

2. **execution.js 没有 crystallize 分支**：execution-callback 路由处理 `content-*` pipeline（5c11块）和 `dev` 串行降级（5c12块），但没有 crystallize 专用块，即使有了回传，pipeline 也不会推进。

3. **executor.js 用 prompt 模式而非 runner 模式**：`triggerCodexBridge` 对 crystallize 类型走 prompt 模式（单次 codex exec），`playwright-runner.sh` 永远不会被调用，形成死循环：runner 没调用 → 没有回传 → pipeline 卡住。

## 修复方案

- `playwright-runner.sh`：添加 `_post_execution_callback` 函数，在成功/失败路径各调用一次，POST 到 Brain `/api/brain/execution-callback`，携带 `script_path` 或错误信息。
- `execution.js`：在 5c11（content pipeline）和 5c12（串行降级）之间插入新的 crystallize 块，用动态 import 调用 `advanceCrystallizeStage`，逻辑与 content pipeline 块对称。
- `executor.js`：新增 `isCrystallize` 标志，为 `crystallize*` 类型设置 runner = `playwright-runner.sh`，runner_args = `['--task-id', task.id]`。

## 下次预防

- [ ] 新增任务类型时，需同步检查 executor.js（runner 模式）+ execution.js（callback 分支）+ runner 脚本（回传） 三处是否都已对接
- [ ] crystallize orchestrator 的 `advanceCrystallizeStage` 函数没有返回 `{advanced}` 字段，execution.js 的 `if (advResult && advResult.advanced)` 不会打印日志（不影响功能，下次可补上）

