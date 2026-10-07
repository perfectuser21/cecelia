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
// 默认低于契约 budget（900s），这样超时由本活动先报明确的 claude_timeout，而不是执行器笼统的 activity_timeout
const DEFAULT_TIMEOUT_MS = 870000;
const KILL_GRACE_MS = 5000;
// 子 claude 不继承 CLAUDECODE / CLAUDE_CODE_*（避免被当成嵌套会话）与钩子遗留的 GIT_*
const CLAUDE_ENV = childEnv(process.env, { stripClaude: true });

function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value), template);
}

/** CODING_WF_SPEC_TIMEOUT_MS 为正整数时采用，否则回退默认。 */
function specTimeoutMs() {
  const raw = process.env.CODING_WF_SPEC_TIMEOUT_MS;
  return /^[1-9][0-9]*$/.test(raw ?? '') && Number.isSafeInteger(Number(raw)) ? Number(raw) : DEFAULT_TIMEOUT_MS;
}

/**
 * 运行子进程，输出全部转写到本进程 stderr；返回 { code, output, timedOut }，spawn 失败时 code 为 null。
 * 超过 timeoutMs 先 SIGTERM，KILL_GRACE_MS 后仍未退出再 SIGKILL，子进程退出后返回 timedOut: true。
 */
function runChild(bin, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let killTimer;
    let child;
    try {
      child = spawn(bin, args, { cwd, env: CLAUDE_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, output: String(error?.message || error) });
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
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
    };
    child.on('error', (error) => {
      clearTimers();
      log(`[spec] 启动 ${bin} 失败: ${error?.message || error}`);
      resolve({ code: null, output: `${output}\n${error?.message || error}`, timedOut: false });
    });
    // 超时后以 exit 为准：claude 的孙进程可能还握着 stdout 管道，等 close 会无限挂起
    child.on('exit', (code) => {
      if (!timedOut) return;
      clearTimers();
      resolve({ code, output, timedOut: true });
    });
    child.on('close', (code) => {
      clearTimers();
      resolve({ code, output, timedOut });
    });
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
  const { code, output, timedOut } = await runChild(bin, args, worktree, specTimeoutMs());

  // 超时直接返回：产物可能写了一半，不检查、不做越界检查
  if (timedOut) return fail('retryable', 'claude_timeout');

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
