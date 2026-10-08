// 子进程工具：统一剥离 CLAUDECODE / CLAUDE_CODE_* / GIT_DIR 等继承变量，带超时。
import { spawn } from 'node:child_process';
import { childEnv } from '../../lib/protocol.mjs';

/** runner 所有子进程的环境：剥离 git 钩子与 claude 会话变量，禁止 git 交互式凭据提示。 */
export function runnerChildEnv(base = process.env) {
  return { ...childEnv(base, { stripClaude: true }), GIT_TERMINAL_PROMPT: '0' };
}

/**
 * 运行命令（不经 shell）。返回 { code, stdout, stderr, timedOut }；启动失败 code=null。
 * 超时或 signal 中止时先 SIGTERM，5 秒后 SIGKILL。
 */
export function run(bin, args, { cwd, timeoutMs = 10 * 60 * 1000, signal } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(bin, args, { cwd, env: runnerChildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout, stderr: String(error?.message || error), timedOut });
      return;
    }
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error?.message || error}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** git -C <dir> ...；输出同 run。 */
export function git(dir, args, opts = {}) {
  return run('git', ['-C', dir, ...args], opts);
}
