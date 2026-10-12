import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const launcher = join(root, 'scripts/claude-launch.sh');
const temp = mkdtempSync(join(tmpdir(), 'launcher-provenance-'));
const requests = [];
let server, url;

function run(extra = {}, args = ['-p', 'probe'], tty = false) {
  const env = { ...process.env, CLAUDE_CODE_EXECPATH: join(temp, 'claude'),
    CLAUDE_SESSION_ID: 'launcher-session', CECELIA_NO_AUTO_WORKTREE: '1',
    CECELIA_DISPATCH: '0', HARNESS_TASK_ID: '', BRAIN_URL: url, ...extra };
  const command = tty ? 'python3' : 'bash';
  const parameters = tty ? ['-c',
    'import os,pty,sys; pid,fd=pty.fork();\nif pid==0: os.execvp("bash",["bash"]+sys.argv[1:])\nelse:\n try:\n  while True:\n   data=os.read(fd,65536)\n   if not data: break\n   os.write(1,data)\n except OSError: pass\n _,s=os.waitpid(pid,0);sys.exit(os.waitstatus_to_exitcode(s))',
    launcher, ...args] : [launcher, ...args];
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { env, cwd: temp });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('exit', code => resolveRun({ code, output }));
  });
}

beforeAll(async () => {
  writeFileSync(join(temp, 'claude'), '#!/bin/bash\nprintf "CLAUDE_STARTED\\n"\n');
  chmodSync(join(temp, 'claude'), 0o755);
  server = createServer((req, res) => {
    let body = '';
    req.on('data', data => { body += data; });
    req.on('end', () => { requests.push({ path: req.url, body: JSON.parse(body) }); res.end('{}'); });
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise(resolveClose => server.close(resolveClose)); rmSync(temp, { recursive: true, force: true }); });

describe('launcher 经 HTTP 登记出处', () => {
  it('无本地 PostgreSQL 时 machine 登记仍到 Brain，JSON 保留特殊字符', async () => {
    const before = requests.length;
    const result = await run({ CECELIA_DISPATCH: '1', CECELIA_LAUNCHED_BY: 'quote"name',
      HARNESS_TASK_ID: 'f9834457-cd9d-4435-8e4c-b6062539aded' });
    expect(result.code).toBe(0);
    expect(result.output).toContain('CLAUDE_STARTED');
    expect(requests.length).toBe(before + 1);
    expect(requests.at(-1)).toEqual({ path: '/api/brain/session-provenance', body: {
      session_id: 'launcher-session', kind: 'machine', launched_by: 'quote"name',
      task_id: 'f9834457-cd9d-4435-8e4c-b6062539aded',
    } });
  });
  it('真实 PTY 人类启动登记 human', async () => {
    const result = await run({}, [], true);
    expect(result.code).toBe(0);
    expect(requests.at(-1).body).toMatchObject({ kind: 'human', launched_by: 'claude-launch-interactive', task_id: null });
  });
  it('未知来源与 dry-run 都不登记', async () => {
    const before = requests.length;
    expect((await run()).code).toBe(0);
    expect((await run({ CECELIA_DISPATCH: '1' }, ['--dry-run', '-p', 'probe'])).code).toBe(0);
    expect(requests.length).toBe(before);
  });
  it('Brain 无响应时 2 秒超时仍启动 Claude', async () => {
    const hanging = createServer(() => {});
    await new Promise(resolveListen => hanging.listen(0, '127.0.0.1', resolveListen));
    const start = Date.now();
    try {
      const result = await run({ CECELIA_DISPATCH: '1', BRAIN_URL: `http://127.0.0.1:${hanging.address().port}` });
      expect(result.code).toBe(0);
      expect(result.output).toContain('CLAUDE_STARTED');
      expect(Date.now() - start).toBeLessThan(3500);
    } finally { hanging.closeAllConnections(); await new Promise(resolveClose => hanging.close(resolveClose)); }
  });
});
