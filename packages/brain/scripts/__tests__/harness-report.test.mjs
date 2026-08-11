import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync, existsSync, rmSync, chmodSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

// Use absolute path so this test works regardless of CWD
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../harness-report.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-report-unit-'));
  writeFileSync(join(dir, 'sprint-prd.md'), '# Sprint PRD — unit fixture\n');
  return dir;
}

function runScript(args, env = {}) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exit: 0, output: out };
  } catch (e) {
    return { exit: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

// 异步版本 —— 用于测试需要在同进程内起本地 http server 并让子进程真实收发请求的场景。
// runScript 是同步 execFileSync：父进程事件循环在等待子进程期间被完全阻塞，
// 此时同进程内的 http server 无法处理任何回调（accept/response），子进程发起的
// fetch 请求会一直挂起 → 死锁。runScriptAsync 用 execFile + promisify，父进程
// 事件循环在 await 期间保持运转，http server 的回调能正常触发。
async function runScriptAsync(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { exit: 0, output: (stdout ?? '') + (stderr ?? '') };
  } catch (e) {
    return { exit: e.code ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('harness-report.mjs unit — 存在性', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('缺少参数时 exit 非零', () => {
    const { exit } = runScript([]);
    expect(exit).not.toBe(0);
  });
});

describe('harness-report.mjs unit — 文件生成', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('三文件生成', () => {
    dir = makeFixture();
    runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake'],
              { BRAIN_URL: 'http://localhost:19999' });
    expect(existsSync(join(dir, 'harness-report.md'))).toBe(true);
    expect(existsSync(join(dir, 'learning.md'))).toBe(true);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });
});

describe('harness-report.mjs — 不受信 Report Runner 不写权威 Feature', () => {
  let server, dir;
  afterEach(() => {
    if (server) server.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('feature 三锚字段皆空时也不读取或 PATCH Journey API', async () => {
    let patchedBody = null;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.method === 'GET' && req.url.includes('/journey_features/feat-empty')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'feat-empty', unit_test_path: null, workflow_ref: null, guard_ref: null }));
        } else if (req.method === 'PATCH' && req.url.includes('/journey_features/feat-empty')) {
          patchedBody = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'feat-empty', ...patchedBody }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        }
      });
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    dir = makeFixture();
    const ghStubPath = join(dir, 'gh-stub.sh');
    writeFileSync(ghStubPath, '#!/usr/bin/env bash\necho "src/foo.ts"\necho "src/__tests__/foo.test.ts"\n');
    chmodSync(ghStubPath, 0o755);

    await runScriptAsync(
      ['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
       '--pr-url', 'https://github.com/test/repo/pull/1', '--feature-id', 'feat-empty'],
      { BRAIN_URL: `http://localhost:${port}`, GH_CMD: ghStubPath }
    );

    expect(patchedBody).toBeNull();
  });

  it('feature 已有锚点时同样不调用 PATCH', async () => {
    let patchCalled = false;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.method === 'GET' && req.url.includes('/journey_features/feat-anchored')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'feat-anchored', unit_test_path: 'already/set.test.ts', workflow_ref: null, guard_ref: null }));
        } else if (req.method === 'PATCH' && req.url.includes('/journey_features/feat-anchored')) {
          patchCalled = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        }
      });
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    dir = makeFixture();
    const ghStubPath = join(dir, 'gh-stub.sh');
    writeFileSync(ghStubPath, '#!/usr/bin/env bash\necho "src/__tests__/other.test.ts"\n');
    chmodSync(ghStubPath, 0o755);

    await runScriptAsync(
      ['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
       '--pr-url', 'https://github.com/test/repo/pull/1', '--feature-id', 'feat-anchored'],
      { BRAIN_URL: `http://localhost:${port}`, GH_CMD: ghStubPath }
    );

    expect(patchCalled).toBe(false);
  });
});
