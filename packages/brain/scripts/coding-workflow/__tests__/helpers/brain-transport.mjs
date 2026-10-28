// 测试专用：默认真实 HTTP；隔离验证可显式选择 Node 子进程 IPC。
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 1024 * 1024;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const PRELOAD = new URL('../fixtures/brain-fetch-preload.mjs', import.meta.url);
const namespace = 'coding-test-brain-v1';

export async function startTestBrain(handler) {
  if (typeof handler !== 'function') throw new TypeError('test_brain_handler_required');
  const mode = process.env.CODING_WF_TEST_TRANSPORT ?? 'http';
  if (!['http', 'ipc'].includes(mode)) throw new Error('test_brain_transport_invalid');
  if (mode === 'http') {
    const server = http.createServer(async (req, res) => {
      try {
        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('test_brain_body_too_large');
        }
        const reply = await handler({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(reply.status, reply.headers ?? {});
        res.end(reply.body);
      } catch (error) { res.destroy(error); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return {
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
      }),
      spawnOptions: () => ({ args: [], stdio: ['pipe', 'pipe', 'pipe'], attach() {} }),
    };
  }
  const url = `http://${randomUUID()}.test-brain.invalid`;
  const preload = new URL(PRELOAD);
  preload.searchParams.set('origin', url);
  const attached = new Map();
  let closed = false;
  function attach(child) {
    if (closed) throw new Error('test_brain_closed');
    if (!child.send) throw new Error('test_brain_ipc_required');
    if (attached.has(child)) throw new Error('test_brain_already_attached');
    const pending = new Set();
    const send = (message) => { if (child.connected) child.send({ namespace, ...message }, () => {}); };
    const message = async (request) => {
      if (request?.namespace !== namespace) return;
      const { id, type } = request;
      if (!Number.isSafeInteger(id) || id < 1) return;
      if (type === 'cancel') { pending.delete(id); return; }
      if (type !== 'fetch' || pending.has(id)) return;
      pending.add(id);
      try {
        const target = new URL(request.url);
        if (target.origin !== url || target.username || target.password) throw new Error('test_brain_origin_denied');
        if (!METHODS.has(request.method)) throw new Error('test_brain_method_denied');
        if (typeof request.body !== 'string' || Buffer.byteLength(request.body) > MAX_BYTES) throw new Error('test_brain_body_invalid');
        const reply = await handler({ method: request.method, url: target.pathname + target.search, headers: request.headers, body: request.body });
        if (!reply || typeof reply.body !== 'string' || Buffer.byteLength(reply.body) > MAX_BYTES) throw new Error('test_brain_response_invalid');
        if (pending.delete(id)) send({ type: 'response', id, status: reply.status, headers: reply.headers, body: reply.body });
      } catch (error) {
        if (pending.delete(id)) send({ type: 'error', id, error: error?.message ?? String(error) });
      }
    };
    const cleanup = () => {
      pending.clear();
      child.off('message', message);
      child.off('close', cleanup);
      child.off('disconnect', cleanup);
      attached.delete(child);
    };
    attached.set(child, cleanup);
    child.on('message', message);
    child.once('close', cleanup);
    child.once('disconnect', cleanup);
  }
  return {
    url,
    async close() {
      closed = true;
      for (const [child, cleanup] of attached) {
        if (child.connected) child.disconnect();
        cleanup();
      }
    },
    spawnOptions: () => ({ args: ['--import', preload.href], stdio: ['pipe', 'pipe', 'pipe', 'ipc'], attach }),
  };
}
