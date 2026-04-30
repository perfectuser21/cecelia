# Fix triggerCodexReview Spawn Error Handler — Design Spec

**日期**: 2026-04-30  
**分支**: cp-0430110615-fix-codex-spawn-error-handler

## 问题

`executor.js` 的 `triggerCodexReview`（第 2278 行）在 `spawn(codexBin, ...)` 后没有 `child.on('error', handler)`。当 codex binary 不存在（ENOENT）或无法启动时，Node.js 把未处理的 EventEmitter error 升级成 Uncaught Exception，把整个 Brain 进程打死，引发 crash loop。

外层 `try-catch` 抓不到这个错误，因为 `spawn()` 本身不抛出——它返回 `ChildProcess` 对象，ENOENT 通过异步 event 传递。

## 修复方案

在 `child.stdout?.on('data', ...)` 之后、`child.on('exit', ...)` 之前加：

```js
child.on('error', async (err) => {
  console.error(`[executor] codex spawn error: ${err.message} task=${task.id}`);
  try { unlinkSync(lockFile); } catch {}
  try {
    const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
    await fetch(`${brainUrl}/api/brain/execution-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.id,
        run_id: runId,
        status: 'AI Failed',
        result: { verdict: 'FAIL', summary: `codex binary not found: ${err.message}` },
        coding_type: 'codex-review',
      }),
    });
  } catch (cbErr) {
    console.error(`[executor] codex spawn callback error: ${cbErr.message}`);
  }
});
```

## 测试策略

单函数行为 → **unit test**：
- mock `spawn` 返回一个 emit 'error' 的假 EventEmitter
- 验证：lockFile cleanup 被调用、execution-callback fetch 被调用且 status='AI Failed'、进程不崩溃（不抛出）
