// spec 活动：用 claude CLI + 薄 prompt 根据 01-intent.md 生成 <sprint_dir>/02-spec.md。
// 格式校验不在这里做，交给 chain_check。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runActivity, validateBase, fail, childEnv, log } from '../lib/protocol.mjs';

const SPEC_FILE = '02-spec.md';
const INTENT_FILE = '01-intent.md';
const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../prompts/spec.md');
const AUTH_RE = /\bauthenticat|\blogin\b|\/login|invalid api key|quota|rate limit/i;
const INTENT_ID_RE = /^[A-Z]+-\d+$/;
// 子 claude 不继承 CLAUDECODE / CLAUDE_CODE_*（避免被当成嵌套会话）与钩子遗留的 GIT_*
const CLAUDE_ENV = childEnv(process.env, { stripClaude: true });
// 默认低于契约 budget（900s），这样超时由本活动先报明确的 claude_timeout，而不是执行器笼统的 activity_timeout
const DEFAULT_TIMEOUT_MS = 870000;
const KILL_GRACE_MS = 5000; // 超时 SIGTERM 之后到 SIGKILL 的宽限
const TIMEOUT_MARGIN_MS = 10000; // 钳制超时时给收尾留的余量
const EXIT_GRACE_MS = 1500; // claude 退出后等输出管道关闭的宽限，过了就整组 SIGKILL
const CANCEL_GRACE_MS = 2500; // 收到执行器 SIGTERM 后到整组 SIGKILL 的宽限（必须短于执行器 cleanup_grace_s 默认 5s）
const GROUP_KILL = process.platform !== 'win32';

function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value), template);
}

/**
 * claude 的超时毫秒数：CODING_WF_SPEC_TIMEOUT_MS 为正整数时采用，否则回退默认；
 * 再钳到 budget.max_duration_s*1000 - KILL_GRACE_MS - TIMEOUT_MARGIN_MS 之内
 * （超过 budget 执行器会先杀本活动，claude 就成了孤儿），最低 1000ms。无 budget 时只用默认/覆盖值。
 */
function specTimeoutMs(budget) {
  const raw = process.env.CODING_WF_SPEC_TIMEOUT_MS;
  const wanted = /^[1-9][0-9]*$/.test(raw ?? '') && Number.isSafeInteger(Number(raw)) ? Number(raw) : DEFAULT_TIMEOUT_MS;
  const budgetS = budget?.max_duration_s;
  if (!Number.isFinite(budgetS) || budgetS <= 0) return wanted;
  const clamp = Math.max(1000, budgetS * 1000 - KILL_GRACE_MS - TIMEOUT_MARGIN_MS);
  return Math.min(wanted, clamp);
}

/** 向 claude 所在进程组发信号（Windows 退化为只杀直接子进程）；进程已不存在（ESRCH）忽略。 */
function signalGroup(child, signal) {
  try {
    if (GROUP_KILL) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') log(`[spec] 向 claude 发送 ${signal} 失败: ${error?.message || error}`);
  }
}

/**
 * 运行子进程，输出全部转写到本进程 stderr；返回 { code, output, timedOut, terminated }，spawn 失败时 code 为 null。
 * - claude 自成进程组（detached，但仍等待它、不 unref），结束时整组收掉，不留孙进程。
 * - 超过 timeoutMs 先 SIGTERM，KILL_GRACE_MS 后仍未退出再 SIGKILL，timedOut: true。
 * - 本进程收到 SIGTERM（执行器取消/超时/心跳失败）：对 claude 组发 SIGTERM，CANCEL_GRACE_MS 后组 SIGKILL，terminated: true。
 * - 正常退出后若输出管道被后代占着，EXIT_GRACE_MS 后整组 SIGKILL 并销毁管道，不等 close。
 */
function runChild(bin, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let terminated = false;
    let finished = false;
    let killTimer;
    let graceTimer;
    let child;
    try {
      child = spawn(bin, args, { cwd, env: CLAUDE_ENV, stdio: ['ignore', 'pipe', 'pipe'], detached: GROUP_KILL });
    } catch (error) {
      resolve({ code: null, output: String(error?.message || error), timedOut: false, terminated: false });
      return;
    }
    const forward = (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);

    const timer = setTimeout(() => {
      timedOut = true;
      log(`[spec] ${bin} 超过 ${timeoutMs}ms，发送 SIGTERM`);
      signalGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
    const onSigterm = () => {
      if (finished || terminated) return;
      terminated = true;
      log('[spec] 收到 SIGTERM，清理 claude 进程组');
      signalGroup(child, 'SIGTERM');
      clearTimeout(killTimer);
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), CANCEL_GRACE_MS);
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
      signalGroup(child, 'SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ output, timedOut, terminated, ...result });
      // 取消路径要保证本进程能在执行器的 SIGKILL 之前自行收尾
      if (terminated) setTimeout(() => process.exit(2), 1000).unref();
    };
    child.on('error', (error) => {
      log(`[spec] 启动 ${bin} 失败: ${error?.message || error}`);
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

/** 在 worktree 里运行 git（不经 shell、禁用 pathspec 魔法），返回 stdout；失败返回 null。 */
function gitOut(worktree, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--literal-pathspecs', '-C', worktree, ...args],
      { env: CLAUDE_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

/**
 * 工作区当前所有改动条目（`XY path`，路径相对仓库根，未跟踪文件逐个列出）。
 * 不是仓库或命令失败返回 null。重命名条目只记新路径。
 */
async function changeEntries(worktree) {
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

/** 运行后新增的、位于 sprint 目录之外的改动路径；无法判定时返回 []。 */
async function outOfScopeChanges(worktree, sprintDir, before) {
  const after = await changeEntries(worktree);
  const prefix = await gitOut(worktree, ['rev-parse', '--show-prefix']);
  if (before === null || after === null || prefix === null) {
    log('[spec] 无法用 git status 检查越界写，跳过');
    return [];
  }
  const known = new Set(before.map((e) => e.key));
  const sprintRel = path.posix.normalize(sprintDir.replace(/\\/g, '/')).replace(/\/+$/, '');
  const scope = `${prefix.trim()}${sprintRel}/`;
  return after.filter((e) => !known.has(e.key) && !e.path.startsWith(scope)).map((e) => e.path);
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds } = input;

  const { dir } = validateBase(input);
  const taskId = input.task_id;
  if (!Array.isArray(intentIds) || intentIds.length === 0) return fail('fatal', 'intent_ids_missing');
  if (!intentIds.every((id) => typeof id === 'string' && INTENT_ID_RE.test(id))) {
    return fail('fatal', 'intent_ids_invalid');
  }

  const specPath = path.join(dir, SPEC_FILE);
  const prompt = renderPrompt(fs.readFileSync(PROMPT_PATH, 'utf8'), {
    TASK_ID: taskId,
    INTENT_PATH: path.join(dir, INTENT_FILE),
    SPEC_PATH: specPath,
    INTENT_IDS: intentIds.join(','),
  });

  // 重试/重跑时旧产物会被当成新产物，先删
  fs.rmSync(specPath, { force: true });
  const before = await changeEntries(worktree);

  const bin = process.env.CODING_WF_CLAUDE_BIN || 'claude';
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash'];
  const { code, output, timedOut, terminated } = await runChild(bin, args, worktree, specTimeoutMs(input.budget));

  // 超时/被取消直接返回：产物可能写了一半，不检查、不做越界检查
  if (timedOut) return fail('retryable', 'claude_timeout');
  if (terminated) return fail('retryable', 'claude_failed', { evidence: [{ terminated: true }] });

  if (code !== 0) {
    if (AUTH_RE.test(output)) return fail('needs_human', 'claude_auth');
    return fail('retryable', 'claude_failed');
  }

  const stray = await outOfScopeChanges(worktree, sprintDir, before);
  if (stray.length > 0) {
    return fail('fatal', 'spec_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
  }
  if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');

  return {
    status: 'completed',
    outputs: { spec_file: SPEC_FILE },
    evidence: [`${SPEC_FILE} 已生成`],
  };
});
