import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const helper = fileURLToPath(new URL('./install-existing-config.py', import.meta.url));
const machine = 'us-mac-m4', runtime = '/usr/local/libexec/cecelia/fleet-worker';
const doc = () => ({ Label: 'com.perfect21.fleet-worker', UserName: '_cecelia',
  ProgramArguments: [process.execPath, `${runtime}/fleet-worker.cjs`],
  EnvironmentVariables: { CECELIA_MACHINE_ID: machine, CECELIA_FLEET_WORKER_HOST: '100.71.151.105',
    CECELIA_FLEET_WORKER_PORT: '5239', CECELIA_FLEET_WORKER_TOKEN_FILE: '/var/lib/cecelia/fleet-worker/worker-auth',
    PATH: '/controlled/bin:/usr/bin:/bin', CECELIA_RUNNER_DIGEST: `sha256:${'0'.repeat(64)}`,
    DB_PASSWORD: 'private-sentinel', GH_TOKEN: 'github-sentinel' }, KeepAlive: true });
function writePlist(file, value, binary = false) {
  execFileSync('python3', ['-c', 'import plistlib,json,sys; plistlib.dump(json.load(sys.stdin),open(sys.argv[1],"wb"),fmt=plistlib.FMT_BINARY if sys.argv[2]=="1" else plistlib.FMT_XML)', file, binary ? '1' : '0'], { input: JSON.stringify(value) });
  fs.chmodSync(file, 0o600);
}
const readPlist = file => JSON.parse(execFileSync('python3', ['-c', 'import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', file], { encoding: 'utf8' }));
function withFiles(fn) {
  expect(fs.existsSync(helper)).toBe(true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-existing-'));
  try { return fn({ root, prior: path.join(root, 'prior.plist'), snapshot: path.join(root, 'snapshot.json'), next: path.join(root, 'next.plist') }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
describe('升级读取现役配置而不泄露或覆盖', () => {
  it.each(['hash', 'hash-type', 'us-mac-m4', 'xian-mac-m1', 'missing-digest', 'other-marker'])('canonical恢复拒绝%s且快照零写', kind => withFiles(f => {
    const original = doc(); const node = ['us-mac-m4', 'xian-mac-m1'].includes(kind) ? kind : 'xian-mac-m4';
    original.EnvironmentVariables.CECELIA_MACHINE_ID = node;
    if (kind === 'missing-digest') delete original.EnvironmentVariables.CECELIA_RUNNER_DIGEST;
    if (kind === 'other-marker') original.EnvironmentVariables.CECELIA_DRAIN_MARKER = '/var/run/cecelia/unrelated-worker.drain';
    writePlist(f.prior, original);
    execFileSync('python3', [helper, 'snapshot', f.prior, node, runtime, f.snapshot]);
    const before = fs.readFileSync(f.snapshot);
    let expected = createHash('sha256').update(fs.readFileSync(f.prior)).digest('hex');
    if (kind === 'hash') expected = 'f'.repeat(64); if (kind === 'hash-type') expected = 'bad';
    const result = spawnSync('python3', [helper, 'canonical-runner', f.snapshot, expected], { encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(fs.readFileSync(f.snapshot)).toEqual(before);
    expect(result.stdout + result.stderr).not.toMatch(/private-sentinel|github-sentinel/);
  }));
  it.each([false, true])('西安M4显式canonical恢复 %s：CAS只切runner，其它配置逐字保留', binary => withFiles(f => {
    const original = doc(); original.EnvironmentVariables.CECELIA_MACHINE_ID = 'xian-mac-m4';
    original.EnvironmentVariables.CECELIA_RUNNER_DIGEST = `sha256:${'0'.repeat(64)}`;
    writePlist(f.prior, original, binary);
    const expected = createHash('sha256').update(fs.readFileSync(f.prior)).digest('hex');
    execFileSync('python3', [helper, 'snapshot', f.prior, 'xian-mac-m4', runtime, f.snapshot]);
    const result = spawnSync('python3', [helper, 'canonical-runner', f.snapshot, expected], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/private-sentinel|github-sentinel/);
    const next = doc(); next.EnvironmentVariables = { CECELIA_MACHINE_ID: 'xian-mac-m4', CECELIA_RUNNER_DIGEST: `sha256:${'f'.repeat(64)}` };
    writePlist(f.next, next); execFileSync('python3', [helper, 'merge', f.next, f.snapshot]);
    expect(readPlist(f.next).EnvironmentVariables).toEqual({ ...original.EnvironmentVariables,
      CECELIA_RUNNER_DIGEST: 'sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033' });
    expect(readPlist(f.prior)).toEqual(original);
    expect(spawnSync('python3', [helper, 'check', f.prior, f.snapshot]).status).toBe(0);
  }));
  it.each([false, true])('XML/binary %s：一份快照驱动探测和最终plist，保留密钥仅落0600', binary => withFiles(f => {
    const original = doc(); original.EnvironmentVariables.CECELIA_DRAIN_MARKER = '/var/run/cecelia/custom-legacy.drain';
    writePlist(f.prior, original, binary);
    const result = spawnSync('python3', [helper, 'snapshot', f.prior, machine, runtime, f.snapshot], { encoding: 'utf8' });
    expect(result.status).toBe(0); expect(result.stdout).toContain('WORKER_BIND_HOST\t100.71.151.105');
    expect(result.stdout).toContain('WORKER_COMMAND_PATH\t/controlled/bin:/usr/bin:/bin');
    expect(result.stdout).toContain('WORKER_PORT\t5239'); expect(result.stdout).toContain('WORKER_TOKEN_FILE\t/var/lib/cecelia/fleet-worker/worker-auth');
    expect(result.stdout + result.stderr).not.toMatch(/private-sentinel|github-sentinel/);
    const next = doc(); next.ProgramArguments[0] = '/opt/homebrew/opt/node@24/bin/node'; next.EnvironmentVariables = { CECELIA_MACHINE_ID: machine, NEW_REQUIRED: 'safe', CECELIA_FLEET_WORKER_HOST: '127.0.0.1' };
    writePlist(f.next, next); execFileSync('python3', [helper, 'merge', f.next, f.snapshot]);
    const merged = readPlist(f.next); expect(merged.EnvironmentVariables).toEqual({ ...next.EnvironmentVariables, ...original.EnvironmentVariables });
    expect(merged.ProgramArguments).toEqual(next.ProgramArguments); expect(merged.KeepAlive).toBe(true);
    for (const file of [f.next, f.snapshot]) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  }));
  it.each(['symlink', 'writable', 'machine', 'label', 'user', 'malformed'])('不可信旧配置 %s 在任何服务动作前拒绝', kind => withFiles(f => {
    const d = doc(); if (kind === 'machine') d.EnvironmentVariables.CECELIA_MACHINE_ID = 'wrong';
    if (kind === 'label') d.Label = 'other'; if (kind === 'user') d.UserName = 'root';
    writePlist(f.prior, d); if (kind === 'writable') fs.chmodSync(f.prior, 0o666);
    if (kind === 'symlink') { fs.renameSync(f.prior, f.prior + '.actual'); fs.symlinkSync(f.prior + '.actual', f.prior); }
    if (kind === 'malformed') fs.writeFileSync(f.prior, 'bad private-sentinel');
    const result = spawnSync('python3', [helper, 'snapshot', f.prior, machine, runtime, f.snapshot], { encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('existing_configuration_untrusted');
    expect(result.stdout + result.stderr).not.toContain('private-sentinel'); expect(fs.existsSync(f.snapshot)).toBe(false);
  }));
  it('替换前核对旧配置指纹，配置被并发改变时拒绝覆盖', () => withFiles(f => {
    writePlist(f.prior, doc()); execFileSync('python3', [helper, 'snapshot', f.prior, machine, runtime, f.snapshot]);
    expect(spawnSync('python3', [helper, 'check', f.prior, f.snapshot]).status).toBe(0);
    fs.appendFileSync(f.prior, '\n'); expect(spawnSync('python3', [helper, 'check', f.prior, f.snapshot]).status).not.toBe(0);
  }));
});
