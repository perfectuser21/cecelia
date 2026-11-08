import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const bridge = require('../../scripts/codex-bridge/codex-bridge.cjs');
const TASK = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const HASH = createHash('sha256').update(JSON.stringify(bridge.buildCallbackPayload({taskId:TASK,runId:RUN,checkpointId:null,status:'completed',output:'test',durationMs:10}))).digest('hex');

describe('Codex Bridge 回执确认', () => {
  let server;
  let destination;
  let received;
  let originalFetch;
  let savedToken;
  let savedEnvFile;

  beforeEach(async () => {
    savedToken = process.env.CECELIA_INTERNAL_TOKEN;
    savedEnvFile = process.env.CECELIA_INTERNAL_ENV_FILE;
    delete process.env.CECELIA_INTERNAL_TOKEN;
    process.env.CECELIA_INTERNAL_ENV_FILE = '/nonexistent/cecelia-internal.env';
    received = [];
    server = createServer((req, res) => {
      received.push(req.url);
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/landing' });
        res.end();
      } else if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>login</html>');
      } else if (req.url === '/skipped') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, skipped: true, reason: 'late_callback_terminal' }));
      } else if (req.url === '/accepted') {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, queued: true }));
      } else if (req.url === '/duplicate') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, duplicate: true }));
      } else if (req.url === '/normal') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, task_id: TASK }));
      } else if (req.url === '/pending-review') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: TASK, run_id: RUN, queued: true, callback_status: 'AI Done', receipt_sha256: HASH, code: 'DECOMP_REVIEW_VERDICT_INVALID' }));
      } else if (req.url === '/pending-wrong-task') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: 'other', run_id: RUN, queued: true, callback_status: 'AI Done', receipt_sha256: HASH, code: 'DECOMP_REVIEW_VERDICT_INVALID' }));
      } else if (req.url === '/pending-wrong-run') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: TASK, run_id: 'other-run', queued: true, callback_status: 'AI Done', receipt_sha256: HASH, code: 'DECOMP_REVIEW_VERDICT_INVALID' }));
      } else if (req.url === '/pending-wrong-status') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: TASK, run_id: RUN, queued: true, callback_status: 'AI Failed', receipt_sha256: HASH, code: 'DECOMP_REVIEW_VERDICT_INVALID' }));
      } else if (req.url === '/pending-wrong-hash') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: TASK, run_id: RUN, queued: true, callback_status: 'AI Done', receipt_sha256: 'wrong', code: 'DECOMP_REVIEW_VERDICT_INVALID' }));
      } else if (req.url === '/pending-no-run') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: TASK, queued: true, callback_status: 'AI Done', receipt_sha256: HASH, code: 'DECOMP_REVIEW_VERDICT_INVALID' }));
      } else if (req.url === '/unpersisted') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, task_id: TASK, queued: false, code: 'TASK_COMPLETION_GUARD_UNAVAILABLE' }));
      } else if (req.url === '/false') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      } else if (req.url === '/wrong-task') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, task_id: 'other' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>login</html>');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (url, options) => originalFetch(`${destination}${new URL(url).pathname}`, options));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise(resolve => server.close(resolve));
    if (savedToken === undefined) delete process.env.CECELIA_INTERNAL_TOKEN;
    else process.env.CECELIA_INTERNAL_TOKEN = savedToken;
    if (savedEnvFile === undefined) delete process.env.CECELIA_INTERNAL_ENV_FILE;
    else process.env.CECELIA_INTERNAL_ENV_FILE = savedEnvFile;
  });

  async function callbackAt(endpoint, runId = RUN) {
    destination = `http://127.0.0.1:${server.address().port}`;
    vi.stubGlobal('fetch', (url, options) => originalFetch(`${destination}${endpoint}`, options));
    return bridge.callbackBrain(TASK, null, 'completed', 'test', 10, runId);
  }

  it('不跟随 302 到登录页面并把其 200 误作回执成功', async () => {
    const outcome = await callbackAt('/redirect');
    expect(outcome).toMatchObject({ outcome: 'unconfirmed', reason: 'redirect' });
    expect(received).toEqual(['/redirect']);
  });

  it('200 HTML 并非确认回执，保持结果未知且不盲重放', async () => {
    const outcome = await callbackAt('/html');
    expect(outcome).toMatchObject({ outcome: 'unconfirmed', reason: 'invalid_ack' });
    expect(received).toEqual(['/html']);
  });

  it('200 skipped 是服务端已确认接收但并不代表任务完成', async () => {
    const outcome = await callbackAt('/skipped');
    expect(outcome).toMatchObject({ outcome: 'acknowledged', skipped: true, reason: 'late_callback_terminal' });
  });

  it('202 queued 是已接受而非声称已处理', async () => {
    const outcome = await callbackAt('/accepted');
    expect(outcome).toMatchObject({ outcome: 'acknowledged', pending: true });
  });

  it('明确已入队的 422 停止重发，但保持业务未确认', async () => {
    expect(await callbackAt('/pending-review')).toMatchObject({ outcome: 'unconfirmed', reason: 'queued_pending', pending: true });
    expect(received).toEqual(['/pending-review']);
  });

  it.each(['/pending-wrong-task', '/pending-wrong-run', '/pending-wrong-status', '/pending-wrong-hash', '/pending-no-run', '/unpersisted'])('%s 不具备持久化身份，不当作已入队', async endpoint => {
    const realTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      if (ms === 5000 && new Error().stack.includes('codex-bridge')) { queueMicrotask(() => fn(...args)); return undefined; }
      return realTimeout(fn, ms, ...args);
    });
    try {
      expect(await callbackAt(endpoint)).toMatchObject({ outcome: 'unconfirmed', reason: 'delivery_failed' });
      expect(received).toEqual([endpoint, endpoint, endpoint]);
    } finally { timer.mockRestore(); }
  });

  it('本次请求缺 run_id 时不会把同任务待核回执当成已确认身份', async () => {
    const realTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      if (ms === 5000 && new Error().stack.includes('codex-bridge')) { queueMicrotask(() => fn(...args)); return undefined; }
      return realTimeout(fn, ms, ...args);
    });
    try {
      expect(await callbackAt('/pending-no-run', null)).toMatchObject({ outcome: 'unconfirmed', reason: 'delivery_failed' });
      expect(received).toEqual(['/pending-no-run', '/pending-no-run', '/pending-no-run']);
    } finally { timer.mockRestore(); }
  });

  it('普通成功和 duplicate 按真实服务端合同确认', async () => {
    expect(await callbackAt('/normal')).toMatchObject({ outcome: 'acknowledged', pending: false });
    expect(await callbackAt('/duplicate')).toMatchObject({ outcome: 'acknowledged', duplicate: true });
  });

  it.each(['/false', '/wrong-task'])('拒绝 %s 不匹配的 2xx 响应且不盲目重放', async endpoint => {
    expect(await callbackAt(endpoint)).toMatchObject({ outcome: 'unconfirmed', reason: 'invalid_ack' });
    expect(received).toEqual([endpoint]);
  });
});
