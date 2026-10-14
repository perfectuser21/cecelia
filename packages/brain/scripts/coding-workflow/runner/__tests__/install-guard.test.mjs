import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv } from './helpers/sandbox.mjs';
const entry = fileURLToPath(new URL('../runtime-install-guard.mjs', import.meta.url));
let root, bin, locks, env;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-install-guard-')); bin = path.join(root, 'bin'); locks = path.join(root, 'locks'); fs.mkdirSync(bin);
  env = { ...cleanTestEnv(), PATH: `${bin}:/usr/bin:/bin`, CODING_WF_LOCK_DIR: locks };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function launch(output, code = 0) {
  fs.writeFileSync(path.join(root, 'output'), output);
  fs.writeFileSync(path.join(bin, 'launchctl'), `#!/bin/sh\ncat '${root}/output'\nexit ${code}\n`, { mode: 0o755 });
}
const run = () => spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 5000 });
it('空闲daemon且无锁允许安装', () => {
  launch('active count = 0\nstate = not running\n'); const r = run(); expect(r.status, r.stderr).toBe(0);
});
it.each(['active count = 1\nstate = running\npid = 123\n', 'active count = 0\npid = 123\n'])('活动daemon拒绝安装', output => {
  launch(output); const r = run(); expect(r.status).not.toBe(0); expect(r.stderr).toContain('runtime_install_daemon_active');
});
it.each(['coding-workflow-runner.lock', 'launcher/coding-workflow-runner.lock'])('活跃锁 %s 拒绝安装且不删除锁', name => {
  launch('active count = 0\nstate = not running\n'); const dir = path.join(locks, name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid)); const r = run();
  expect(r.status).not.toBe(0); expect(r.stderr).toContain('runtime_install_runner_active'); expect(fs.existsSync(dir)).toBe(true);
});
it('读launchd失败或未知输出拒绝安装', () => {
  launch('unknown', 1); expect(run().status).not.toBe(0);
  launch('unknown'); expect(run().status).not.toBe(0);
});
it('尚未安装该daemon可安装', () => {
  launch('Could not find service "com.cecelia.coding-workflow-runner" in domain for system', 113);
  const r = run(); expect(r.status, r.stderr).toBe(0);
});
