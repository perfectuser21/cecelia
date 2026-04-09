# Task Card: Brain headless session_id + serial workstream

**Task ID**: d3f06568-21d4-438c-ac56-f597e9192519  
**Branch**: cp-04092253-brain-headless-serial-ws  
**Priority**: P1

## 目标

### F1: executor.js — 无头模式 session_id 注入
无头模式（headless）下 `tty` 不可用，Stop Hook `_session_matches()` 只能靠 `CLAUDE_SESSION_ID` 识别会话。
在 `triggerCeceliaRun()` 中向 `extraEnv` 注入 `CLAUDE_SESSION_ID: task.id`，通过 cecelia-bridge 传递到 Claude Code 进程。

### F2: execution.js — Workstream 改为串行
APPROVED 后目前并行创建 N 个 `harness_generate`，改为只创建 WS1，WS1 完成后再链式触发 WS2…WsN。

## 改动文件
- `packages/brain/src/executor.js`: 注入 CLAUDE_SESSION_ID
- `packages/brain/src/routes/execution.js`: APPROVED 只创建 WS1 + harness_generate 完成后链式触发

## 成功标准
- executor.js extraEnv 含 CLAUDE_SESSION_ID
- APPROVED 只创建 workstream_index=1 的任务
- harness_generate 完成后，若 workstream_index < workstream_count，触发下一个
