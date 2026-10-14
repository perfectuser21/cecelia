// 安装前只读探测：不停止服务，不删除任何锁；看不清即拒绝，由外层等空闲后重试。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeProcess } from './runtime-process.mjs';
import { pathToFileURL } from 'node:url';

export async function assertIdle({ env = process.env, allowLauncherPid = null } = {}) {
  const service = await runtimeProcess('launchctl', ['print', 'system/com.cecelia.coding-workflow-runner'], {
    env, timeoutMs: 5000,
  });
  const output = `${service.stdout ?? ''}\n${service.stderr ?? ''}`;
  if (service.terminated) throw new Error('runtime_install_daemon_unknown');
  if (service.code !== 0) {
    if (service.error || !output.includes('Could not find service "com.cecelia.coding-workflow-runner"')) throw new Error('runtime_install_daemon_unknown');
  } else {
    const count = /^\s*active count = (\d+)\s*$/m.exec(output);
    if (!count) throw new Error('runtime_install_daemon_unknown');
    if (Number(count[1]) > 0 || /^\s*pid = [1-9]\d*\s*$/m.test(output) || /^\s*state = running\s*$/m.test(output)) {
      throw new Error('runtime_install_daemon_active');
    }
  }
  const locks = env.CODING_WF_LOCK_DIR || path.join(env.HOME || os.homedir(), '.cecelia');
  for (const name of ['coding-workflow-runner.lock', 'launcher/coding-workflow-runner.lock']) {
    const dir = path.join(locks, name);
    if (!fs.existsSync(dir)) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim(); }
    catch { throw new Error('runtime_install_lock_unknown'); }
    if (!/^[1-9]\d*$/.test(raw)) throw new Error('runtime_install_lock_unknown');
    if (name.startsWith('launcher/') && Number(raw) === allowLauncherPid) continue;
    try { process.kill(Number(raw), 0); }
    catch (error) {
      if (error.code === 'ESRCH') continue;
      throw new Error('runtime_install_runner_active');
    }
    throw new Error('runtime_install_runner_active');
  }
  return { loaded: service.code === 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await assertIdle({ allowLauncherPid: Number(process.env.CODING_WF_INSTALL_LOCK_PID) || null }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
