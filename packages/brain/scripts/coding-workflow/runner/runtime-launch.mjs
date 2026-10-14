// 外层锁覆盖自更新到子进程收尾；更新时另外占用 run-once 的锁，保护直接启动的在途任务。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictLock } from './runtime-lock.mjs';
import { runtimeProcess } from './runtime-process.mjs';
import { updateClone } from './runtime-update.mjs';
import { checkRuntimeHealth, codexEnvironment } from './runtime-health.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = message => console.error(`[${new Date().toISOString()}] [coding-workflow-runner.sh] ${message}`);
const env = process.env;
const repo = env.CODING_WF_REPO || path.join(env.HOME || os.homedir(), 'perfect21/cecelia-cw-runner');
const control = new AbortController();
const stop = () => control.abort();
process.on('SIGTERM', stop); process.on('SIGINT', stop);
const locks = env.CODING_WF_LOCK_DIR || path.join(env.HOME || os.homedir(), '.cecelia');

async function main() {
  const outer = strictLock(path.join(locks, 'launcher'));
  if (!outer) { log('启动器已运行，本轮不换代码、不重复执行'); return 0; }
  let updateLock;
  try {
    updateLock = strictLock(locks);
    if (!updateLock) { log('run-once 已持锁，本轮不换代码、不重复执行'); return 0; }
    await checkRuntimeHealth(env, { signal: control.signal });
    if (!fs.existsSync(path.join(repo, '.git'))) {
      fs.mkdirSync(path.dirname(repo), { recursive: true });
      const clone = await runtimeProcess('git', ['clone', '-q', env.CODING_WF_ORIGIN_URL || 'https://github.com/perfectuser21/cecelia.git', repo], { signal: control.signal });
      if (clone.code !== 0 || clone.terminated || control.signal.aborted) throw new Error('runtime_clone_failed');
    }
    await updateClone(repo, log, { signal: control.signal });
    if (control.signal.aborted) return 143;
    // 到这里更新已完成。内锁交给 run-once 自己获取；外锁仍阻止第二个启动器更新。
    updateLock.release(); updateLock = null;
    const childEnv = env.CODING_WF_PROVIDER === 'codex' ? codexEnvironment(env) : env;
    const grace = Number(env.CODING_WF_LAUNCHER_KILL_GRACE_MS);
    const result = await runtimeProcess('/bin/bash', [path.join(here, 'runtime-run.sh')], {
      env: childEnv, signal: control.signal, timeoutMs: 0, inherit: true,
      // 覆盖 run-once 原有最坏 198s 的租约/终态收尾，短于 launchd 240s ExitTimeOut。
      graceMs: Number.isFinite(grace) && grace > 0 ? grace : 210000,
    });
    return result.code ?? (control.signal.aborted ? 143 : 1);
  } finally { updateLock?.release(); outer.release(); }
}
main().then(code => { process.exitCode = code; process.off('SIGTERM', stop); process.off('SIGINT', stop); }).catch(error => {
  // 仅输出本地定义的错误码；子进程原始错误可能带命令/环境，不扩散。
  log(/^runtime_[a-z_]+$/.test(error.message) ? error.message : 'runtime_start_failed');
  process.exitCode = 1; process.off('SIGTERM', stop); process.off('SIGINT', stop);
});
