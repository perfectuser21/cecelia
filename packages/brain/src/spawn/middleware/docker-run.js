/**
 * docker-run middleware — Brain v2 Layer 3（Executor）attempt-loop 内循环的终点。
 * 见 docs/design/brain-orchestrator-v2.md §5.2（内层 attempt-loop 第 d 步）。
 *
 * 职责：接收已经 build 好的 docker args + opts，执行 child_process.spawn('docker', args, ...)，
 * 捕获 stdout/stderr，超时 kill，返回统一 result shape。不做账号选择、不做 cascade、不做 429 判定 —
 * 那些都在外层 middleware。
 *
 * Harness W6（fix invoke hang）：三种异常路径必须 reject Promise，不能 resolve 或挂起：
 *   1. 容器外部被 SIGKILL（exit code=137 或 signal='SIGKILL'）→ reject('OOM_killed')
 *   2. 容器进程信号 SIGKILL（任何 exit code 配 signal='SIGKILL'）→ reject('SIGKILL')
 *   3. stdout EOF 但 'exit' 事件没跟上来（docker daemon 卡死）→ STDOUT_EOF_GRACE_MS 内 reject
 *
 * 唯一例外：当我们自己的 timeout 触发 docker kill 时（timedOut=true），仍然 resolve 出
 * `{ timed_out:true, exit_code:137 }`，保留给上游 retry-circuit / cap-marking 中间件
 * 既有的处理契约。否则 Promise 必 reject，让 caller 通过 try/catch 走错误路径，避免 LangGraph
 * invoke() 因为 Promise 永不 settle 而无限挂起（W1 stuck 的最底层根因）。
 *
 * @param {string[]} args       完整 docker CLI 参数（来自 buildDockerArgs）
 * @param {object}  opts        { taskId, taskType, timeoutMs, name, cidfile, command }
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, container, container_id, command, timed_out, started_at, ended_at }>}
 *          rejection 是 Error，挂载 .code（'OOM_KILLED' | 'STDOUT_EOF_NO_EXIT'）+ 上下文字段
 */
import { spawn as nodeSpawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { readContainerIdFromCidfile } from '../../docker-executor.js';

// stdout 'end' 之后等多久还没收到 'exit' 就视为 docker daemon hang。
// 100ms 已经远大于正常进程关 stdio 到触发 'exit' 的间隔（通常 <1ms），
// 但小到不会拖慢任何成功路径。env override 留给 forensic 调高观察。
const STDOUT_EOF_GRACE_MS = parseInt(
  process.env.CECELIA_DOCKER_STDOUT_EOF_GRACE_MS || '100',
  10
);

export async function runDocker(args, opts) {
  const { taskId, taskType, timeoutMs, name, cidfile, command } = opts;

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let exited = false;
    let settled = false;
    let stdoutEofTimer = null;

    function settle(action) {
      if (settled) return;
      settled = true;
      if (stdoutEofTimer) clearTimeout(stdoutEofTimer);
      action();
    }

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const killTimer = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[docker-run] timeout task=${taskId} after ${timeoutMs}ms — docker kill ${name}`
      );
      nodeSpawn('docker', ['kill', name], { stdio: 'ignore' });
    }, timeoutMs);

    // stdout EOF 但 'exit' 没跟来 → 触发 hang 救援 reject。
    // 正常情况下 stdout 'end' 与 'exit' 间隔 <1ms，100ms 内 exited=true 就 noop。
    proc.stdout.on('end', () => {
      if (exited || settled) return;
      stdoutEofTimer = setTimeout(() => {
        if (exited || settled) return;
        clearTimeout(killTimer);
        const endedAt = new Date().toISOString();
        const duration = Date.now() - startedAtMs;
        console.error(
          `[docker-run] STDOUT_EOF_NO_EXIT task=${taskId} container=${name} grace=${STDOUT_EOF_GRACE_MS}ms`
        );
        const err = new Error(
          `docker-run hang: stdout EOF without process exit task=${taskId} container=${name}`
        );
        err.code = 'STDOUT_EOF_NO_EXIT';
        err.taskId = taskId;
        err.container = name;
        err.container_id = readContainerIdFromCidfile(cidfile);
        err.command = command;
        err.duration_ms = duration;
        err.started_at = startedAt;
        err.ended_at = endedAt;
        err.stdout = stdout;
        err.stderr = stderr;
        err.exit_code = -1;
        err.timed_out = timedOut;
        if (cidfile && existsSync(cidfile)) {
          try { unlinkSync(cidfile); } catch { /* ignore */ }
        }
        settle(() => reject(err));
      }, STDOUT_EOF_GRACE_MS);
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      console.error(`[docker-run] spawn error task=${taskId}: ${err.message}`);
      const endedAt = new Date().toISOString();
      // spawn error（docker binary 不存在等）保持 resolve(exit_code=-1) 老契约 —
      // 这是 host 环境问题不是容器异常，retry-circuit 会标 permanent。
      settle(() => resolve({
        exit_code: -1,
        stdout,
        stderr: stderr + `\n[docker-run] spawn error: ${err.message}`,
        duration_ms: Date.now() - startedAtMs,
        container: name,
        container_id: null,
        command,
        timed_out: false,
        started_at: startedAt,
        ended_at: endedAt,
      }));
    });

    proc.on('exit', (code, signal) => {
      exited = true;
      clearTimeout(killTimer);
      const duration = Date.now() - startedAtMs;
      const endedAt = new Date().toISOString();
      console.log(
        `[docker-run] exit task=${taskId} code=${code} signal=${signal} duration=${duration}ms timed_out=${timedOut}`
      );
      if (String(taskType).startsWith('harness_') && code !== 0) {
        console.log('[docker-run] HARNESS_STDOUT_TAIL:', (stdout || '').slice(-2000));
        console.log('[docker-run] HARNESS_STDERR_TAIL:', (stderr || '').slice(-2000));
      }
      const containerId = readContainerIdFromCidfile(cidfile);
      if (cidfile && existsSync(cidfile)) {
        try { unlinkSync(cidfile); } catch { /* ignore */ }
      }

      // OOM / 外部 SIGKILL：非我方 timeout 触发的 137 / SIGKILL 必须 reject。
      // - timedOut=true：是我们 docker kill 触发的（超时正常路径），保留 resolve(timed_out:true) 老契约
      // - timedOut=false 且 (code=137 OR signal=SIGKILL)：容器被外部 OOM killer / 用户手动 kill，
      //   reject 让 caller 走 try/catch 错误路径，避免 invoke() Promise 永不 settle。
      const isExternalKill =
        !timedOut && (code === 137 || signal === 'SIGKILL');
      if (isExternalKill) {
        const reason = signal === 'SIGKILL' ? 'SIGKILL' : 'OOM_killed (exit=137)';
        const err = new Error(
          `docker-run container ${reason} task=${taskId} container=${name} exit=${code} signal=${signal}`
        );
        err.code = 'OOM_KILLED';
        err.taskId = taskId;
        err.container = name;
        err.container_id = containerId;
        err.command = command;
        err.exit_code = code == null ? -1 : code;
        err.signal = signal;
        err.duration_ms = duration;
        err.timed_out = false;
        err.started_at = startedAt;
        err.ended_at = endedAt;
        err.stdout = stdout;
        err.stderr = stderr;
        settle(() => reject(err));
        return;
      }

      settle(() => resolve({
        exit_code: code == null ? -1 : code,
        stdout,
        stderr,
        duration_ms: duration,
        container: name,
        container_id: containerId,
        command,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: endedAt,
      }));
    });
  });
}
