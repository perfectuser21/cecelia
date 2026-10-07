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

function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value), template);
}

/** 运行子进程，输出全部转写到本进程 stderr；返回 { code, output }，spawn 失败时 code 为 null。 */
function runChild(bin, args, cwd) {
  return new Promise((resolve) => {
    let output = '';
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
    child.on('error', (error) => {
      log(`[spec] 启动 ${bin} 失败: ${error?.message || error}`);
      resolve({ code: null, output: `${output}\n${error?.message || error}` });
    });
    child.on('close', (code) => resolve({ code, output }));
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
  const { code, output } = await runChild(bin, args, worktree);

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
