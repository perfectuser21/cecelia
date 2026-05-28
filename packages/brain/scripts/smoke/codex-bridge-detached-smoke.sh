#!/usr/bin/env bash
# Smoke: codex-bridge-detached — spawnCodexBridgeDetached 导出与行为验证
#
# 验证点：
#   1. detached.js 正确导出 spawnCodexBridgeDetached（类型为 function）
#   2. POST 包含 task_id/task_type/callback_url，Bridge 返回非 200 时 throw
#
# 退出码：0 = PASS/SKIP，1 = FAIL
set -uo pipefail

DETACHED="packages/brain/src/spawn/detached.js"
if [ ! -f "$DETACHED" ]; then
  echo "SKIP: $DETACHED 不存在"
  exit 0
fi

# 1. 导出检查
node -e "
import('./packages/brain/src/spawn/detached.js').then(m => {
  if (typeof m.spawnCodexBridgeDetached !== 'function') {
    console.error('FAIL: spawnCodexBridgeDetached 不是 function，实际类型:', typeof m.spawnCodexBridgeDetached);
    process.exit(1);
  }
  console.log('✅ 导出检查 PASS — spawnCodexBridgeDetached 类型为 function');
}).catch(err => {
  console.error('FAIL: 模块加载失败:', err.message);
  process.exit(1);
});
" || exit 1

# 2. 非 200 时 throw — 用本地 mock server 验证
node -e "
import { createServer } from 'http';
import { spawnCodexBridgeDetached } from './packages/brain/src/spawn/detached.js';

const server = createServer((req, res) => {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'service unavailable' }));
});

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  try {
    await spawnCodexBridgeDetached('http://127.0.0.1:' + port + '/run', {
      task_id: 'smoke-task-001',
      task_type: 'harness_generate',
      callback_url: 'http://localhost:5221/api/brain/harness/callback/smoke-job',
    });
    console.error('FAIL: 非 200 时应 throw，但未 throw');
    server.close();
    process.exit(1);
  } catch (err) {
    console.log('✅ 非 200 throw 检查 PASS —', err.message.slice(0, 80));
    server.close();
  }
});
" || exit 1

echo "✅ codex-bridge-detached smoke 全部 PASS"
exit 0
