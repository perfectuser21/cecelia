// 安装和启动共用外锁；先禁未来触发再核 idle，失败恢复旧配置与启用状态。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strictLock } from './runtime-lock.mjs';
import { runtimeProcess } from './runtime-process.mjs';
import { assertIdle } from './runtime-install-guard.mjs';
const label = 'com.cecelia.coding-workflow-runner';

export async function withInstallation({ script, dest = `/Library/LaunchDaemons/${label}.plist`, env = process.env, signal } = {}) {
  const locks = env.CODING_WF_LOCK_DIR || path.join(env.HOME || os.homedir(), '.cecelia');
  // root安装首次创建的锁父目录也须归实际运行用户，否则后续daemon无法建锁。
  if (process.getuid?.() === 0 && env.CODING_WF_RUN_USER) {
    const uid = await runtimeProcess('id', ['-u', env.CODING_WF_RUN_USER], { env });
    const gid = await runtimeProcess('id', ['-g', env.CODING_WF_RUN_USER], { env });
    if (uid.code !== 0 || gid.code !== 0 || !/^\d+\s*$/.test(uid.stdout) || !/^\d+\s*$/.test(gid.stdout)) throw new Error('runtime_install_user_unknown');
    for (const dir of [locks, path.join(locks, 'launcher')]) if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true }); fs.chownSync(dir, Number(uid.stdout), Number(gid.stdout));
    }
  }
  const lock = strictLock(path.join(locks, 'launcher'));
  if (!lock) throw new Error('runtime_install_launcher_busy');
  let disabledBefore, loadedBefore, changedDisable = false, backup, installing = false, preserveLock = false;
  const managedProcess = async (...args) => {
    try { return await runtimeProcess(...args); }
    catch (error) {
      if (error.message === 'runtime_process_cleanup_unverified') preserveLock = true;
      throw error;
    }
  };
  const ctl = async (...args) => {
    const result = await managedProcess('launchctl', args, { env, timeoutMs: 10000 });
    if (result.code !== 0 || result.terminated) throw new Error(`runtime_install_launchctl_${args[0]}_failed`);
    return result.stdout;
  };
  try {
    const disabled = await ctl('print-disabled', 'system');
    const match = /"com\.cecelia\.coding-workflow-runner"\s*=>\s*(true|false)/.exec(disabled);
    if (!match && !/disabled services\s*=\s*\{/.test(disabled)) throw new Error('runtime_install_disabled_state_unknown');
    disabledBefore = match?.[1] === 'true';
    if (!disabledBefore) { await ctl('disable', `system/${label}`); changedDisable = true; }
    ({ loaded: loadedBefore } = await assertIdle({ env, allowLauncherPid: process.pid }));
    backup = fs.existsSync(dest) ? { bytes: fs.readFileSync(dest), mode: fs.statSync(dest).mode & 0o777 } : null;
    if (loadedBefore && !backup) throw new Error('runtime_install_existing_plist_missing');
    const installEnv = { ...env };
    if (!installEnv.CODING_WF_AUTOMERGE && backup) {
      const xml = backup.bytes.toString('utf8');
      const dict = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml)?.[1];
      if (!dict) throw new Error('runtime_install_existing_config_unreadable');
      const value = /<key>CODING_WF_AUTOMERGE<\/key>\s*<string>([^<]*)<\/string>/.exec(dict)?.[1];
      if (value !== undefined) {
        if (!['0', '1'].includes(value)) throw new Error('runtime_install_existing_automerge_invalid');
        installEnv.CODING_WF_AUTOMERGE = value;
      }
    }
    if (signal?.aborted) throw new Error('runtime_install_cancelled');
    installing = true;
    const result = await managedProcess('/bin/bash', [script, '--runtime-install-locked'], {
      env: { ...installEnv, CODING_WF_INSTALL_LOCK_PID: String(process.pid) }, signal, timeoutMs: 0, inherit: true,
    });
    if (result.code !== 0 || result.terminated || signal?.aborted) throw new Error('runtime_install_failed');
    if (!disabledBefore) await ctl('enable', `system/${label}`);
    return 0;
  } catch (error) {
    if (error.message === 'runtime_process_cleanup_unverified') {
      preserveLock = true; // 安装子进程可能仍活跃：不并发回滚、不重新启用周期服务。
      throw error;
    }
    if (installing) {
      const current = await managedProcess('launchctl', ['print', `system/${label}`], { env, timeoutMs: 5000 });
      const currentOutput = `${current.stdout}\n${current.stderr}`;
      if (current.terminated || (current.code !== 0 && !currentOutput.includes(`Could not find service "${label}"`))) {
        throw new Error('runtime_install_rollback_state_unknown');
      }
      const loadedNow = current.code === 0;
      const bytesNow = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      const fileChanged = backup ? !bytesNow?.equals(backup.bytes) : bytesNow !== null;
      // 前置失败尚未动文件/服务时不重启。首次安装则必须撤销新加载的服务。
      if (loadedNow && (!loadedBefore || fileChanged)) await ctl('bootout', `system/${label}`);
      if (backup && fileChanged) {
        fs.writeFileSync(dest, backup.bytes, { mode: backup.mode }); fs.chmodSync(dest, backup.mode);
      } else if (!backup && bytesNow) fs.unlinkSync(dest);
      // 原本未加载的旧plist只恢复文件，不能替用户把服务启动起来。
      if (loadedBefore && (!loadedNow || fileChanged)) await ctl('bootstrap', 'system', dest);
    }
    if (changedDisable) await ctl('enable', `system/${label}`);
    throw error;
  } finally { if (!preserveLock) lock.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const control = new AbortController(); const stop = () => control.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try { process.exitCode = await withInstallation({ script: process.argv[2], signal: control.signal }); }
  catch (error) { console.error(/^runtime_/.test(error.message) ? error.message : 'runtime_install_failed'); process.exitCode = 1; }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
