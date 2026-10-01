import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWithTestBrain } from '../../scripts/with-test-brain.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-runner-test-')); dirs.push(dir);
  const serverScript = join(dir, 'server.cjs');
  const pidFile = join(dir, 'pid');
  writeFileSync(serverScript, `require('fs').writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));\n${body}`);
  return { serverScript, pidFile, env: { ...process.env, FIXTURE_PID_FILE: pidFile } };
}
function gone(pid) { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } }

describe('测试 Brain 的进程所有权与清理', () => {
  it.each([0, 7])('测试命令退出 %s 后，忽略 TERM 的模拟服务也被回收', async code => {
    const f = fixture(`process.on('SIGTERM',()=>{}); process.send({type:'brain-test-ready'}); setInterval(()=>{},100);`);
    const result = await runWithTestBrain([process.execPath, '-e', `process.exit(${code})`], { ...f, graceMs: 50, startupTimeoutMs: 2000 });
    expect(result).toBe(code);
    expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
  });
  it('启动未就绪时，超时清理实际 PID，测试命令不执行', async () => {
    const f = fixture(`process.on('SIGTERM',()=>{}); setInterval(()=>{},100);`);
    const output = join(dirs.at(-1), 'unexpected');
    await expect(runWithTestBrain([process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(output)},'bad')`],
      { ...f, graceMs: 50, startupTimeoutMs: 500 })).rejects.toThrow(/就绪超时/);
    expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
    expect(() => readFileSync(output)).toThrow();
  });
  it('即使父环境指定生产，子服务仍强制测试隔离且禁迁移', async () => {
    const f = fixture(`
      const e=process.env;
      if(e.NODE_ENV!=='test'||e.DB_NAME!=='cecelia_scratch'||e.CECELIA_LLM_DISABLED!=='true'||e.SKIP_MIGRATIONS!=='true') process.exit(9);
      process.send({type:'brain-test-ready'}); setInterval(()=>{},100);
    `);
    expect(await runWithTestBrain([process.execPath, '-e', 'process.exit(0)'],
      { ...f, env: { ...f.env, NODE_ENV: 'production', DB_NAME: 'cecelia' }, graceMs: 50, startupTimeoutMs: 2000 })).toBe(0);
  });
  it('启动直接失败时不执行测试命令', async () => {
    const f = fixture('process.exit(8);');
    await expect(runWithTestBrain([process.execPath, '-e', 'process.exit(0)'],
      { ...f, graceMs: 50, startupTimeoutMs: 2000 })).rejects.toThrow(/就绪前退出: 8/);
    expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
  });
  it('测试命令不存在时仍回收模拟服务', async () => {
    const f = fixture(`process.on('SIGTERM',()=>{}); process.send({type:'brain-test-ready'}); setInterval(()=>{},100);`);
    await expect(runWithTestBrain(['/definitely-missing-brain-test-command'],
      { ...f, graceMs: 50, startupTimeoutMs: 2000 })).rejects.toThrow(/ENOENT/);
    expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
  });
  it('执行超时回收服务和忽略 TERM 的测试命令', async () => {
    const f = fixture(`process.send({type:'brain-test-ready'}); setInterval(()=>{},100);`);
    const testPid = join(dirs.at(-1), 'test-pid');
    await expect(runWithTestBrain([process.execPath, '-e',
      `require('fs').writeFileSync(${JSON.stringify(testPid)},String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},100);`],
      { ...f, graceMs: 50, startupTimeoutMs: 2000, timeoutMs: 500 })).rejects.toThrow(/执行超时/);
    expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
    expect(gone(Number(readFileSync(testPid, 'utf8')))).toBe(true);
  });
  it('整个强制清理期间保留中断监听，避免第二次中断遗留进程', async () => {
    const f = fixture(`process.on('SIGTERM',()=>{}); process.send({type:'brain-test-ready'}); setInterval(()=>{},100);`);
    const before = process.listeners('SIGTERM');
    const pending = runWithTestBrain([process.execPath, '-e', 'setInterval(()=>{},100)'],
      { ...f, graceMs: 300, startupTimeoutMs: 2000 });
    const handler = process.listeners('SIGTERM').find(fn => !before.includes(fn));
    expect(handler).toBeDefined();
    const rejection = expect(pending).rejects.toThrow(/中断/);
    // ready 后才中断，保证进入真实存活服务的 TERM 等待阶段。
    await new Promise(resolve => setTimeout(resolve, 120));
    handler();
    await new Promise(resolve => setTimeout(resolve, 30));
    const retained = process.listeners('SIGTERM').includes(handler);
    handler();
    await rejection;
    expect(retained).toBe(true);
    expect(process.listeners('SIGTERM')).not.toContain(handler);
    expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
  });
  it('KILL 后暂时返回 EPERM 时继续确认进程组回收', async () => {
    const f = fixture(`process.on('SIGTERM',()=>{}); process.send({type:'brain-test-ready'}); setInterval(()=>{},100);`);
    const nativeKill = process.kill.bind(process);
    let killed, injected = false;
    const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGKILL') killed = pid;
      if (pid === killed && signal === 0 && !injected) {
        injected = true;
        throw Object.assign(new Error('transient EPERM'), { code: 'EPERM' });
      }
      return nativeKill(pid, signal);
    });
    try {
      expect(await runWithTestBrain([process.execPath, '-e', 'process.exit(0)'],
        { ...f, graceMs: 50, startupTimeoutMs: 2000 })).toBe(0);
      expect(injected).toBe(true);
      expect(gone(Number(readFileSync(f.pidFile, 'utf8')))).toBe(true);
    } finally { spy.mockRestore(); }
  });
});
