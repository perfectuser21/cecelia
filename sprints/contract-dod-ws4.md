# Contract DoD — Workstream 4: F4 前端可见（LiveMonitor 事件推送）

**范围**: 在 `events/taskEvents.js` 新增 `publishTaskDispatched(task)`；在 `websocket.js` 的 `WS_EVENTS` 常量加 `TASK_DISPATCHED`。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/events/taskEvents.js` 命名导出 `publishTaskDispatched`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/events/taskEvents.js','utf8');if(!/export\s+function\s+publishTaskDispatched\b/.test(c)&&!/export\s*\{[^}]*\bpublishTaskDispatched\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/websocket.js` 的 WS_EVENTS 常量含 `TASK_DISPATCHED`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/websocket.js','utf8');if(!/TASK_DISPATCHED/.test(c))process.exit(1)"

- [ ] [ARTIFACT] taskEvents.js 中 publishTaskDispatched 调用 broadcast 函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/events/taskEvents.js','utf8');const slice=c.split(/publishTaskDispatched/)[1]||'';if(!/broadcast\(/.test(slice))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/livemonitor-events.test.ts`，覆盖：
- taskEvents.js 导出 publishTaskDispatched
- publishTaskDispatched(task) 调用 broadcast 一次，event 类型为 TASK_DISPATCHED
- publishTaskDispatched payload 包含 taskId / runId / status，status==="dispatched"
- publishTaskStarted payload status==="running"
- publishTaskCompleted payload status==="completed"
- publishTaskDispatched 调用是同步的（不延迟到 microtask 之外）
