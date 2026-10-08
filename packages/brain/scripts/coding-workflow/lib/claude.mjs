// claude CLI 子进程公共逻辑：spec / build / verify 共用。
// 进程组收割、超时 SIGTERM→SIGKILL、执行器取消、退出宽限、env 剥离、鉴权判定、越界写快照都在这里。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail, childEnv, log } from './protocol.mjs';
import { claudeOwnErrorText } from './transcript.mjs';

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../prompts');
// 只认 claude CLI 自身的鉴权/额度报错措辞；裸 login、/login 路由等业务输出不算
const AUTH_RE = /\bauthenticat|please run \/login|invalid api key|quota|rate limit/i;
const KILL_GRACE_MS = 5000; // 超时 SIGTERM 之后到 SIGKILL 的宽限
const TIMEOUT_MARGIN_MS = 10000; // 钳制超时时给收尾留的余量
const EXIT_GRACE_MS = 1500; // claude 退出后等输出管道关闭的宽限，过了就整组 SIGKILL
const CANCEL_GRACE_MS = 2500; // 收到执行器 SIGTERM 后到整组 SIGKILL 的宽限（必须短于执行器 cleanup_grace_s 默认 5s）
const GROUP_KILL = process.platform !== 'win32';
const GIT_TIMEOUT_MS = 60000; // ls-remote 等网络操作卡住时按失败处理

const GH_TOKEN_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN'];

/**
 * 子 claude / git 的环境：不继承 CLAUDECODE / CLAUDE_CODE_*（避免被当成嵌套会话）与钩子遗留的 GIT_*；凭据提示一律关掉。
 * 也不继承 runner 配置 CODING_WF_*：会话里跑的 runner 测试会被它污染（ea2feb66 实测）。
 */
function claudeEnv() {
  const env = { ...childEnv(process.env, { stripClaude: true }), GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(env)) if (key.startsWith('CODING_WF_')) delete env[key];
  return env;
}

/**
 * 防误操作的远端闸：剥离 GH 令牌、GH_CONFIG_DIR 指向空目录（gh 读不到登录态）。
 * 不是安全边界：SSH agent 等其他凭据途径仍在，真正兜底的是活动前后的 ls-remote 比对。
 */
function remoteIsolatedEnv(ghConfigDir) {
  const env = claudeEnv();
  for (const key of GH_TOKEN_KEYS) delete env[key];
  env.GH_CONFIG_DIR = ghConfigDir;
  return env;
}

// coding 链所有 claude 会话固定 Opus（决策 ac7c8801）：不显式指定时实测落到 sonnet
const DEFAULT_MODEL = 'claude-opus-5-5';

/** 调用方没给 --model 时在末尾追加（CODING_WF_CLAUDE_MODEL 覆盖默认）。 */
function withModel(args) {
  if (args.includes('--model')) return args;
  return [...args, '--model', process.env.CODING_WF_CLAUDE_MODEL || DEFAULT_MODEL];
}

/** 把模板里的 `{{KEY}}` 换成 vars[KEY]（值按字面量插入，不解释 `$&` 等替换序列）。 */
export function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value), template);
}

/** 读 prompts/<name>.md 并渲染。 */
export function loadPrompt(name, vars) {
  return renderPrompt(fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8'), vars);
}

/**
 * claude 的超时毫秒数：env[envVar] 为正整数时采用，否则回退 defaultMs；
 * 再钳到 budget.max_duration_s*1000 - KILL_GRACE_MS - TIMEOUT_MARGIN_MS - reserveMs 之内
 * （超过 budget 执行器会先杀活动，claude 就成了孤儿；reserveMs 留给 claude 退出后的检查阶段），最低 1000ms。
 * 无 budget 时只用默认/覆盖值。
 */
export function claudeTimeoutMs(budget, { envVar, defaultMs, reserveMs = 0, env = process.env }) {
  const raw = env[envVar];
  const wanted = /^[1-9][0-9]*$/.test(raw ?? '') && Number.isSafeInteger(Number(raw)) ? Number(raw) : defaultMs;
  const budgetS = budget?.max_duration_s;
  if (!Number.isFinite(budgetS) || budgetS <= 0) return wanted;
  const clamp = Math.max(1000, budgetS * 1000 - KILL_GRACE_MS - TIMEOUT_MARGIN_MS - reserveMs);
  return Math.min(wanted, clamp);
}

/**
 * runClaude 结果的失败映射：超时 → retryable claude_timeout；被取消 → retryable claude_failed（evidence 标 terminated）；
 * 非 0 且像鉴权/额度问题 → needs_human claude_auth；其余非 0 → retryable claude_failed。退出 0 返回 null。
 * streamJson（stdout 是 stream-json 对话记录，含工具输出）时只看 claude 自身的错误事件与 stderr，
 * 不扫描 tool_result 里的业务输出；否则扫描全部输出。
 */
export function claudeFailure({ code, output, stdout = '', stderr = '', timedOut, terminated }, { streamJson = false } = {}) {
  if (timedOut) return fail('retryable', 'claude_timeout');
  if (terminated) return fail('retryable', 'claude_failed', { evidence: [{ terminated: true }] });
  if (code === 0) return null;
  const authText = streamJson ? `${claudeOwnErrorText(stdout)}\n${stderr}` : output;
  if (AUTH_RE.test(authText)) return fail('needs_human', 'claude_auth');
  return fail('retryable', 'claude_failed');
}

/** 向 claude 所在进程组发信号（Windows 退化为只杀直接子进程）；进程已不存在（ESRCH）忽略。 */
function signalGroup(child, signal, tag) {
  try {
    if (GROUP_KILL) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') log(`[${tag}] 向 claude 发送 ${signal} 失败: ${error?.message || error}`);
  }
}

/**
 * 运行 claude（CODING_WF_CLAUDE_BIN 覆盖可执行文件），输出全部转写到本进程 stderr；
 * 返回 { code, output, stdout, stderr, timedOut, terminated }（output 为两者合并，stdout/stderr 各一份供解析与判定），
 * spawn 失败时 code 为 null。isolateRemote 时套 remoteIsolatedEnv，临时 GH_CONFIG_DIR 结束后删除。
 * - claude 自成进程组（detached，但仍等待它、不 unref），结束时整组收掉，不留孙进程。
 * - 超过 timeoutMs 先 SIGTERM，KILL_GRACE_MS 后仍未退出再 SIGKILL，timedOut: true。
 * - 本进程收到 SIGTERM（执行器取消/超时/心跳失败）：对 claude 组发 SIGTERM，CANCEL_GRACE_MS 后组 SIGKILL，terminated: true。
 * - 正常退出后若输出管道被后代占着，EXIT_GRACE_MS 后整组 SIGKILL 并销毁管道，不等 close。
 */
export async function runClaude({ args: callerArgs, cwd, timeoutMs, tag, isolateRemote = false }) {
  const args = withModel(callerArgs);
  if (!isolateRemote) return spawnClaude({ args, cwd, timeoutMs, tag, env: claudeEnv() });
  const ghConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-wf-gh-'));
  try {
    return await spawnClaude({ args, cwd, timeoutMs, tag, env: remoteIsolatedEnv(ghConfigDir) });
  } finally {
    fs.rmSync(ghConfigDir, { recursive: true, force: true });
  }
}

function spawnClaude({ args, cwd, timeoutMs, tag, env }) {
  const bin = process.env.CODING_WF_CLAUDE_BIN || 'claude';
  return new Promise((resolve) => {
    let output = '';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let terminated = false;
    let finished = false;
    let killTimer;
    let graceTimer;
    let child;
    try {
      child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: GROUP_KILL });
    } catch (error) {
      const message = String(error?.message || error);
      resolve({ code: null, output: message, stdout: '', stderr: message, timedOut: false, terminated: false });
      return;
    }
    const forward = (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      forward(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      forward(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      log(`[${tag}] ${bin} 超过 ${timeoutMs}ms，发送 SIGTERM`);
      signalGroup(child, 'SIGTERM', tag);
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL', tag), KILL_GRACE_MS);
    }, timeoutMs);
    const onSigterm = () => {
      if (finished || terminated) return;
      terminated = true;
      log(`[${tag}] 收到 SIGTERM，清理 claude 进程组`);
      signalGroup(child, 'SIGTERM', tag);
      clearTimeout(killTimer);
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL', tag), CANCEL_GRACE_MS);
    };
    process.once('SIGTERM', onSigterm);

    // 统一收尾：停计时器、整组 SIGKILL 收掉存活的后代、销毁管道（后代可能还握着），再返回
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
      process.off('SIGTERM', onSigterm);
      signalGroup(child, 'SIGKILL', tag);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ output, stdout, stderr, timedOut, terminated, ...result });
      // 取消路径要保证本进程能在执行器的 SIGKILL 之前自行收尾
      if (terminated) setTimeout(() => process.exit(2), 1000).unref();
    };
    child.on('error', (error) => {
      log(`[${tag}] 启动 ${bin} 失败: ${error?.message || error}`);
      finish({ code: null, output: `${output}\n${error?.message || error}`, timedOut: false, terminated: false });
    });
    child.on('exit', (code) => {
      // 超时/取消后以 exit 为准；正常退出则给输出管道一个短宽限，仍不关就强收
      if (timedOut || terminated) finish({ code });
      else graceTimer = setTimeout(() => finish({ code }), EXIT_GRACE_MS);
    });
    child.on('close', (code) => finish({ code }));
  });
}

/** 在 worktree 里运行 git（不经 shell、禁用 pathspec 魔法、不弹凭据提示、60s 超时），返回 stdout；失败返回 null。 */
export async function gitOut(worktree, args) {
  const { code, stdout } = await gitRun(worktree, args);
  return code === 0 ? stdout : null;
}

/** 同 gitOut，但返回 { code, stdout }：code 为退出码，启动失败/超时为 null（用于区分"答案是否"与"执行失败"）。 */
export function gitRun(worktree, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--literal-pathspecs', '-C', worktree, ...args],
      { env: claudeEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' && !error.killed ? error.code : null) : 0, stdout }),
    );
  });
}

/** 当前 HEAD 的 SHA；不是仓库或没有提交返回 null。 */
export async function headSha(worktree) {
  return (await gitOut(worktree, ['rev-parse', '--verify', 'HEAD']))?.trim() || null;
}

/**
 * 工作区当前所有改动条目（{ key: `XY path`, path }，路径相对仓库根，未跟踪文件逐个列出）。
 * 不是仓库或命令失败返回 null。重命名条目只记新路径。
 */
export async function snapshotChanges(worktree) {
  const out = await gitOut(worktree, ['status', '--porcelain', '-z', '-uall']);
  if (out === null) return null;
  const parts = out.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const xy = parts[i].slice(0, 2);
    entries.push({ key: parts[i], path: parts[i].slice(3) });
    if (xy.includes('R') || xy.includes('C')) i += 1; // 后随一个原路径条目
  }
  return entries;
}

/**
 * 相对 before 快照新增的改动，按是否位于 sprint 目录分成 { scope, inside, outside }（路径相对仓库根，
 * scope 为 sprint 目录前缀）；无法用 git status 判定时返回 null。
 */
async function newChanges(worktree, sprintDir, before) {
  const after = await snapshotChanges(worktree);
  const prefix = await gitOut(worktree, ['rev-parse', '--show-prefix']);
  if (before === null || after === null || prefix === null) return null;
  const known = new Set(before.map((e) => e.key));
  const sprintRel = path.posix.normalize(sprintDir.replace(/\\/g, '/')).replace(/\/+$/, '');
  const scope = `${prefix.trim()}${sprintRel}/`;
  const fresh = after.filter((e) => !known.has(e.key)).map((e) => e.path);
  return { scope, inside: fresh.filter((p) => p.startsWith(scope)), outside: fresh.filter((p) => !p.startsWith(scope)) };
}

/** 相对 before 快照新增的、位于 sprint 目录之外的改动路径；无法判定时返回 []。 */
export async function outOfScopeChanges(worktree, sprintDir, before, tag = 'claude') {
  const changes = await newChanges(worktree, sprintDir, before);
  if (changes === null) log(`[${tag}] 无法用 git status 检查越界写，跳过`);
  return changes?.outside ?? [];
}

/** 相对 before 快照新增的、sprint 目录内除 allowed（文件名）以外的改动路径；无法判定时返回 []。 */
export async function sprintChangesExcept(worktree, sprintDir, before, allowed, tag = 'claude') {
  const changes = await newChanges(worktree, sprintDir, before);
  if (changes === null) log(`[${tag}] 无法用 git status 检查 sprint 目录，跳过`);
  return changes?.inside.filter((p) => p !== `${changes.scope}${allowed}`) ?? [];
}
