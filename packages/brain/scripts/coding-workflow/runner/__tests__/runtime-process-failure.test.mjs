import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv } from './helpers/sandbox.mjs';
import { gitPlain } from '../../__tests__/helpers/git.mjs';
const processModule = new URL('../runtime-process.mjs', import.meta.url).href;
const launcher = fileURLToPath(new URL('../runner.sh', import.meta.url));
let root, bin, marker, childFile;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ps-failure-'))); bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  marker = path.join(root, 'child.pid'); childFile = path.join(root, 'owned-child.mjs');
  fs.writeFileSync(childFile, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`);
});
afterEach(() => {
  if (fs.existsSync(marker)) {
    const pid = Number(fs.readFileSync(marker));
    try { const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      if (command.includes(childFile)) process.kill(pid, 'SIGKILL');
    } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
});
function fakePs(mode) {
  fs.writeFileSync(path.join(bin, 'ps'), `#!${process.execPath}
const fs=require('fs'), cp=require('child_process'); const countFile=${JSON.stringify(path.join(root, 'count'))};
const n=fs.existsSync(countFile)?Number(fs.readFileSync(countFile)):0; fs.writeFileSync(countFile,String(n+1));
if(${JSON.stringify(mode)}==='always-fail'||n>0)process.exit(7);
process.stdout.write(cp.execFileSync('/bin/ps',process.argv.slice(2)));`, { mode: 0o755 });
}
function probe(mode) {
  fakePs(mode); const file = path.join(root, 'probe.mjs');
  fs.writeFileSync(file, `import {runtimeProcess} from ${JSON.stringify(processModule)};
try { await runtimeProcess(process.execPath,[${JSON.stringify(childFile)}],{timeoutMs:80,graceMs:80}); console.log('unexpected success'); }
catch(e) { console.error(e.message); process.exitCode=1; }`);
  return spawnSync(process.execPath, [file], { env: { ...cleanTestEnv(), PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8', timeout: 4000 });
}
it('spawn前ps不可得：有界失败且根本不启动子进程', () => {
  const r = probe('always-fail');
  expect(r.error).toBeUndefined(); expect(r.status).toBe(1);
  expect(r.stderr).toContain('runtime_process_identity_unavailable'); expect(fs.existsSync(marker)).toBe(false);
});
it('spawn后ps失效：不盲杀未知PID，有界返回明确未清理异常', () => {
  const r = probe('after-first');
  expect(r.error).toBeUndefined(); expect(r.status).toBe(1);
  expect(r.stderr).toContain('runtime_process_cleanup_unverified');
  expect(fs.existsSync(marker)).toBe(true); expect(() => process.kill(Number(fs.readFileSync(marker)),0)).not.toThrow();
});
it('启动器遇到更新子进程归属未知时有界退出并保留两把锁阻止续跑', () => {
  const clone = path.join(root, 'clone'); gitPlain('init', '-q', '-b', 'main', clone);
  fakePs('after-first');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nexec '${process.execPath}' '${childFile}'\n`, { mode: 0o755 });
  // 外层探针只终止自己启动的launcher；测试cleanup只清理已核命令仍匹配的自有child。
  const probeFile = path.join(root, 'launch-probe.mjs');
  fs.writeFileSync(probeFile, `import {spawn} from 'node:child_process'; import fs from 'node:fs';
const c=spawn('/bin/bash',[${JSON.stringify(launcher)}],{stdio:['ignore','pipe','pipe']});c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);
const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(t);c.kill('SIGTERM');}},20);
c.once('exit',code=>{clearInterval(t);process.exitCode=code;});`);
  const locks = path.join(root, 'locks');
  const r = spawnSync(process.execPath, [probeFile], { env: { ...cleanTestEnv(), PATH: `${bin}:/usr/bin:/bin`, CODING_WF_NODE: process.execPath, CODING_WF_REPO: clone, CODING_WF_PROVIDER: 'claude', CODING_WF_LOCK_DIR: locks }, encoding: 'utf8', timeout: 6000 });
  expect(r.error).toBeUndefined(); expect(r.status).toBe(1); expect(r.stderr).toContain('runtime_process_cleanup_unverified');
  expect(fs.existsSync(path.join(locks, 'launcher/coding-workflow-runner.lock'))).toBe(true);
  expect(fs.existsSync(path.join(locks, 'coding-workflow-runner.lock'))).toBe(true);
}, 10000);
