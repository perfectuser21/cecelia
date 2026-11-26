import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectGone, readPid, waitForFile } from './helpers/procs.mjs';

it('共享provider收到真实SIGTERM后清理拒绝TERM的模型及孙进程，并保留取消结果', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-cancel-'));
  const modelPid = path.join(root, 'model.pid'), grandchildPid = path.join(root, 'grandchild.pid');
  const model = path.join(root, 'model.mjs'), bin = path.join(root, 'model'), entry = path.join(root, 'wrapper.mjs');
  const source = fileURLToPath(new URL('../lib/claude.mjs', import.meta.url));
  fs.writeFileSync(model, `import fs from 'node:fs';import {spawn} from 'node:child_process';
process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(modelPid)},String(process.pid));
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(grandchildPid)},String(child.pid));setInterval(()=>{},1000);`);
  fs.writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath}' '${model}' "$@"\n`, { mode: 0o700 });
  fs.writeFileSync(entry, `import {runClaude} from ${JSON.stringify(source)};const result=await runClaude({provider:'claude',args:['-p','cancel fixture'],cwd:${JSON.stringify(root)},timeoutMs:60000,tag:'cancel-guard'});console.log(JSON.stringify(result));`);
  const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, CODING_WF_CLAUDE_BIN: bin }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const finished = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let timeout;
  try {
    await Promise.all([waitForFile(modelPid), waitForFile(grandchildPid)]);
    const started = Date.now();
    timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.kill('SIGTERM');
    const exit = await finished;
    expect(exit.signal, stderr).toBeNull();
    expect(JSON.parse(stdout)).toMatchObject({ terminated: true, timedOut: false });
    expect(Date.now() - started).toBeLessThan(7000);
    await expectGone(readPid(modelPid), '模型进程');
    await expectGone(readPid(grandchildPid), '模型孙进程');
  } finally {
    clearTimeout(timeout);
    child.kill('SIGKILL');
    for (const file of [modelPid, grandchildPid]) if (fs.existsSync(file)) {
      const pid = readPid(file);
      try { process.kill(-pid, 'SIGKILL'); } catch { /* 已退出或非组长 */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ }
    }
    await finished;
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20000);
