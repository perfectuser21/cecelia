// 仅测试 helper 通过 --import 注入；无 IPC/origin 就失败，永不回退真实网络。
const namespace = 'coding-test-brain-v1';
const origin = new URL(import.meta.url).searchParams.get('origin');
if (!origin || !process.send || !process.connected) throw new Error('test_brain_preload_requires_ipc');
const pending = new Map();
let sequence = 0;
function unrefIdle() { if (pending.size === 0) process.channel?.unref(); }
function settle(id, error, response) {
  const item = pending.get(id);
  if (!item) return;
  pending.delete(id);
  item.signal?.removeEventListener('abort', item.abort);
  if (error) item.reject(error); else item.resolve(response);
  unrefIdle();
}
process.on('message', (message) => {
  if (message?.namespace !== namespace || !pending.has(message.id)) return;
  if (message.type === 'error') settle(message.id, new TypeError(message.error));
  else if (message.type === 'response') {
    try {
      const body = pending.get(message.id).method === 'HEAD' || [204, 205, 304].includes(message.status) ? null : message.body;
      settle(message.id, null, new Response(body, { status: message.status, headers: message.headers }));
    } catch (error) { settle(message.id, error); }
  }
});
process.on('disconnect', () => {
  for (const id of pending.keys()) settle(id, new TypeError('test_brain_disconnected'));
});
unrefIdle();
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const target = new URL(request.url);
  if (target.origin !== origin || target.username || target.password) throw new TypeError('test_brain_origin_denied');
  if (request.signal.aborted) throw request.signal.reason;
  if (!process.connected) throw new TypeError('test_brain_disconnected');
  const body = await request.text();
  if (Buffer.byteLength(body) > 1024 * 1024) throw new TypeError('test_brain_body_too_large');
  if (request.signal.aborted) throw request.signal.reason;
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const abort = () => {
      settle(id, request.signal.reason);
      if (process.connected) process.send({ namespace, type: 'cancel', id }, () => {});
    };
    pending.set(id, { resolve, reject, signal: request.signal, abort, method: request.method });
    request.signal.addEventListener('abort', abort, { once: true });
    process.channel?.ref();
    process.send({ namespace, type: 'fetch', id, url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body }, (error) => {
      if (error) settle(id, new TypeError('test_brain_disconnected'));
    });
  });
};
