// 测试专用：只给明确的假执行器接通父 runner 的测试 fetch，真实执行器不拦截。
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const params = new URL(import.meta.url).searchParams;
const executor = params.get('executor');
const fetchPreload = params.get('fetchPreload');
const namespace = 'coding-test-brain-v1';
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (bin, args, options) {
  if (bin !== process.execPath || args?.[0] !== executor) return originalSpawn(bin, args, options);
  const child = originalSpawn(bin, ['--import', fetchPreload, ...args], {
    ...options, stdio: [...options.stdio.slice(0, 3), 'ipc'],
  });
  const pending = new Map();
  const send = (message) => { if (child.connected) child.send({ namespace, ...message }, () => {}); };
  child.on('message', async (request) => {
    if (request?.namespace !== namespace) return;
    const { id, type } = request;
    if (!Number.isSafeInteger(id) || id < 1) return;
    if (type === 'cancel') { pending.get(id)?.abort(); pending.delete(id); return; }
    if (type !== 'fetch' || pending.has(id)) return;
    const controller = new AbortController();
    pending.set(id, controller);
    try {
      const response = await fetch(request.url, {
        method: request.method, headers: request.headers,
        ...(!['GET', 'HEAD'].includes(request.method) ? { body: request.body } : {}),
        signal: controller.signal,
      });
      const body = await response.text();
      if (pending.delete(id)) send({ type: 'response', id, status: response.status, headers: Object.fromEntries(response.headers), body });
    } catch (error) {
      if (pending.delete(id)) send({ type: 'error', id, error: error.message });
    }
  });
  child.once('disconnect', () => { for (const controller of pending.values()) controller.abort(); pending.clear(); });
  return child;
};
syncBuiltinESMExports();
