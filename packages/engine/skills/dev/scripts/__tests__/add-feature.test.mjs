import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// 注意：这里必须用异步 execFile（而非 execFileSync）。
// execFileSync 会同步阻塞 Node 事件循环，而下面的假 Brain 服务器
// 跑在同一个进程里 —— 若用 execFileSync，子进程发出的请求永远等不到
// 父进程事件循环去 accept，会死锁挂起（已实测复现）。
const execFileAsync = promisify(execFile);

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../add-feature.js');

function withFakeBrain(handler) {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, JSON.parse(body || '{}'), res));
    });
    server.listen(0, () => resolvePromise(server));
  });
}

describe('add-feature.js --workflow-ref/--guard-ref 透传', () => {
  let server;
  afterEach(() => { if (server) server.close(); });

  it('透传 workflow_ref 和 guard_ref 到 POST body', async () => {
    let capturedBody = null;
    let capturedAuthorization = null;
    server = await withFakeBrain((req, body, res) => {
      capturedBody = body;
      capturedAuthorization = req.headers.authorization;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'f1', name: body.name, thickness: body.thickness }));
    });
    const port = server.address().port;

    await execFileAsync('node', [
      SCRIPT, '--name', 'Test Feature', '--journey-id', 'j1',
      '--workflow-ref', 'e2e/foo.spec.ts', '--guard-ref', 'script:bar.ts',
    ], {
      env: {
        ...process.env,
        BRAIN_URL: `http://127.0.0.1:${port}`,
        CECELIA_INTERNAL_TOKEN: 'test-internal-token',
      },
      encoding: 'utf8', timeout: 10000,
    });

    expect(capturedBody.workflow_ref).toBe('e2e/foo.spec.ts');
    expect(capturedBody.guard_ref).toBe('script:bar.ts');
    expect(capturedAuthorization).toBe('Bearer test-internal-token');
  });

  it('不传时 workflow_ref/guard_ref 为 null(向后兼容)', async () => {
    let capturedBody = null;
    server = await withFakeBrain((req, body, res) => {
      capturedBody = body;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'f1', name: body.name, thickness: body.thickness }));
    });
    const port = server.address().port;

    await execFileAsync('node', [SCRIPT, '--name', 'Test Feature'], {
      env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${port}` }, encoding: 'utf8', timeout: 10000,
    });

    expect(capturedBody.workflow_ref).toBeNull();
    expect(capturedBody.guard_ref).toBeNull();
  });
});
