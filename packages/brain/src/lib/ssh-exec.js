/**
 * ssh-exec.js — Brain 经 ssh 把活推给跑场机的两个传输原语（openclaw-agent 与 script 执行体共用）。
 *
 * 从 openclaw-agent-executor.js 原样抽出（第二个使用者出现，棒 3）；行为不变：
 *   · sshWithStdin：派发用。stdin 灌入后必须 end（远端 `cat` / `sh -s` 要等 EOF），自管超时，
 *     超时 kill 子进程并 reject，绝不让一条卡住的 ssh 挂死整轮派发。用 spawn 不用 execFile——
 *     execFile 没有 input 选项，stdin 既不会被写入也不会被关闭。
 *   · sshRun：收割用。不需要 stdin，execFile 足够。
 * 两者都只接收 spawnFn / execFileFn 注入，单测与集成测试用假传输替换，绝不真发 ssh。
 */

export const SSH_SPAWN_TIMEOUT_MS = 30_000;

export function sshWithStdin(spawnFn, args, input, timeoutMs = SSH_SPAWN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退了就算了 */ }
      finish(reject, new Error(`ssh timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, Object.assign(new Error(`ssh exit ${code}: ${stderr.slice(0, 200)}`), { stderr }));
    });
    // 必须 end 而不是 write：远端要等 EOF 才往下走。
    child.stdin?.end(input ?? '');
  });
}

export function sshRun(execFileFn, args, opts) {
  return new Promise((resolve, reject) => {
    execFileFn('ssh', args, opts, (err, stdout, stderr) => (
      err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout))
    ));
  });
}
