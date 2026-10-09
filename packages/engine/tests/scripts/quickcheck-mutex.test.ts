import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// quickcheck 互斥锁：同一 repo 同时只跑一个 quickcheck。
// 2026-10-08 起语义：拿不到锁时**等待**（上限 QUICKCHECK_LOCK_WAIT_SEC），等到后照常检查；
// 超时失败（exit 1）而不是放行——旧行为"跳过并 exit 0"等于没检查就让 push 通过。
const LOCK_LIB = join(process.cwd(), '..', '..', 'scripts', 'lib', 'quickcheck-lock.sh');
const HAS_FLOCK = spawnSync('bash', ['-c', 'command -v flock']).status === 0;

function writeWorkload(dir: string, impl: 'flock' | 'mkdir'): string {
  const script = join(dir, 'qc.sh');
  writeFileSync(script, [
    '#!/usr/bin/env bash',
    `export QUICKCHECK_LOCK_IMPL=${impl}`,
    `source "${LOCK_LIB}"`,
    `acquire_quickcheck_lock "${dir}/qc.lock" "${dir}/qc.lockdir" || exit 1`,
    'echo "[test] working" >&2',
    'sleep "${HOLD_SEC:-2}"',
    `touch "${dir}/ran.$$"`,
    '',
  ].join('\n'));
  execSync(`chmod +x "${script}"`);
  return script;
}

function runAsync(script: string, env: Record<string, string> = {}) {
  const child = spawn('bash', [script], { env: { ...process.env, ...env }, stdio: 'pipe' });
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
  const done = new Promise<{ code: number | null; out: string }>(resolve =>
    child.on('close', code => resolve({ code, out })));
  return { child, done };
}

const markers = (dir: string) => readdirSync(dir).filter(f => f.startsWith('ran.'));

describe.each([
  ['mkdir', true],
  ['flock', HAS_FLOCK],
] as const)('quickcheck 互斥锁（%s 实现）', (impl, available) => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qcmutex-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!available)('并发第二个等待第一个结束后照常执行，两个都跑完', async () => {
    const script = writeWorkload(dir, impl);
    const first = runAsync(script, { HOLD_SEC: '2' });
    await new Promise(r => setTimeout(r, 300));
    const second = runAsync(script, { HOLD_SEC: '0' });
    const [r1, r2] = await Promise.all([first.done, second.done]);
    expect(r1.code).toBe(0);
    expect(r2.code).toBe(0);
    expect(markers(dir).length).toBe(2);
  }, 20000);

  it.skipIf(!available)('等待超时则失败（exit 1），不放行', async () => {
    const script = writeWorkload(dir, impl);
    const first = runAsync(script, { HOLD_SEC: '4' });
    await new Promise(r => setTimeout(r, 300));
    const second = spawnSync('bash', [script], {
      env: { ...process.env, HOLD_SEC: '0', QUICKCHECK_LOCK_WAIT_SEC: '1' }, encoding: 'utf8',
    });
    expect(second.status).toBe(1);
    await first.done;
    expect(markers(dir).length).toBe(1);
  }, 20000);

  it.skipIf(!available)('锁在脚本结束后释放，下一次立即能跑', () => {
    const script = writeWorkload(dir, impl);
    expect(spawnSync('bash', [script], { env: { ...process.env, HOLD_SEC: '0' } }).status).toBe(0);
    expect(existsSync(join(dir, 'qc.lockdir'))).toBe(false);
    const again = spawnSync('bash', [script], {
      env: { ...process.env, HOLD_SEC: '0', QUICKCHECK_LOCK_WAIT_SEC: '1' }, encoding: 'utf8',
    });
    expect(again.status).toBe(0);
    expect(markers(dir).length).toBe(2);
  }, 15000);
});

describe('quickcheck 互斥锁（mkdir 陈旧锁回收）', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qcmutex-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('持锁进程已不存在（被强杀）时回收锁并立即执行', () => {
    const script = writeWorkload(dir, 'mkdir');
    const dead = spawnSync('bash', ['-c', 'echo $$']).stdout.toString().trim();
    mkdirSync(join(dir, 'qc.lockdir'));
    writeFileSync(join(dir, 'qc.lockdir', 'pid'), `${dead}\n`);
    const r = spawnSync('bash', [script], {
      env: { ...process.env, HOLD_SEC: '0', QUICKCHECK_LOCK_WAIT_SEC: '2' }, encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(markers(dir).length).toBe(1);
  }, 15000);
});
