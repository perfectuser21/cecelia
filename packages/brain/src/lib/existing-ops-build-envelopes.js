/** 固定 build/publish 测试的只读执行来源证明；不执行候选程序。 */
// 封套取自正式 Git 2eb4d0557365befafed1953140c9c47e20bab495。
// 仅作 AST 对照数据，不执行：runActivityProcess/baseEnv、runActivity/childEnv、
// runClaude 的 provider/isolateRemote 分支、loadPrompt/renderPrompt、withModel/openSink/claudeTimeoutMs、
// build main 至首次 runClaude 的前缀、spawnClaude 至真正 spawn 的前缀。
// 不冻结整个 build main；额外模板字段仅接受已审 INTENT_PATH。未知结构变化失败关闭，需显式重审。
export const ENVELOPES = {
  testImports: `import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';`,
  testConstants: `const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/build.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const SPEC = \`---\\ntask_id: \${TASK_ID}\\nstep: spec\\nupstream: ["01-intent.md#I-1"]\\n---\\n# spec\\n\\n### S-1\\n一\\n\\n### S-2\\n二\\n\`;`,
  helperImports: `import { spawn } from 'node:child_process';`,
  helperConstants: `const GIT_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];`,
  activityImports: `import { sumCostUsd } from '../lib/transcript.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { parseFrontmatter, extractAnchors, reportErrors } from '../lib/md-chain.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, gitOut, headSha, snapshotChanges, outOfScopeChanges, sprintChangesExcept,
} from '../lib/claude.mjs';
import {
  chainTamperFailure, remoteChangeFailure, remoteSnapshot, currentBranch, isAncestor, changedFilesSince, agentConfigFiles,
} from '../lib/guards.mjs';
import { checksFor, runPrechecks } from '../lib/ci-precheck.mjs';
import { repoRules } from '../lib/repo-profile.mjs';
import { intentHeading, prKindOf } from '../lib/pr-kind.mjs';`,
  activityConstants: `const spend = { usd: 0 };
const SPEC_FILE = '02-spec.md';
const BUILD_FILE = '03-build.md';
const SPEC_ID_RE = /^S-\\d+$/;
const TIMEOUT = { envVar: 'CODING_WF_BUILD_TIMEOUT_MS', defaultMs: 2310000, reserveMs: 75000 };
const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];
const PRECHECK_FIX_ROUNDS = 2;
const PRECHECK_FIX_TIMEOUT_MS = 10 * 60 * 1000;
const posInt = (v, d) => (/^[1-9][0-9]*$/.test(v ?? '') ? Number(v) : d);
const gitCheckFailed = (check) => fail('retryable', 'git_check_failed', { evidence: [{ check }] });
const failedNames = (results) => results.filter((r) => !r.ok).map((r) => r.name);`,
  cliImports: `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail, childEnv, log } from './protocol.mjs';
import { claudeOwnErrorText, sessionCostUsd } from './transcript.mjs';
import { prepareCodexSession } from './codex-session.mjs';`,
  cliConstants: `const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../prompts');
const AUTH_RE = /\\bauthenticat|please run \\/login|invalid api key|quota|rate limit|usage limit|not logged in|login required/i;
const KILL_GRACE_MS = 5000;
const TIMEOUT_MARGIN_MS = 10000;
const EXIT_GRACE_MS = 1500;
const CANCEL_GRACE_MS = 2500;
const GROUP_KILL = process.platform !== 'win32';
const GIT_TIMEOUT_MS = 60000;
const GH_TOKEN_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN'];
const DEFAULT_MODEL = 'opus';
const withCostOutput = (args) => (args.includes('--output-format') ? args : [...args, '--output-format', 'json']);`,
  protocolImports: `import fs from 'node:fs';
import path from 'node:path';`,
  protocolConstants: `const OUTPUT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATUSES = new Set(['completed', 'partial', 'failed']);
const FAILURE_CLASSES = new Set(['retryable', 'needs_human', 'fatal']);
const GIT_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];`,
  publishTestImports: `import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { git, gitPlain } from './helpers/git.mjs';`,
  publishTestConstants: `const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/publish.mjs');
const FAKE_GH = path.join(HERE, 'fixtures/fake-gh.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const TITLE = 'docs(sprint): 11111111 md 链 01-intent → 02-spec';`,
  testDeclarations: `let root;
let worktree;
let sprintAbs;
const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    spec_file: '02-spec.md',
    ...patch,
  });
const run = (mode, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), { CODING_WF_PROVIDER: 'claude', CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: mode, ...extraEnv });
const buildFile = () => path.join(sprintAbs, '03-build.md');
const head = () => git(worktree, 'rev-parse', 'HEAD').trim();`,
  testHooks: `beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-'));
    worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    initCommittableRepo(worktree, path.join(root, 'no-hooks'));
    sprintAbs = path.join(worktree, 'sprints/s1');
    fs.mkdirSync(sprintAbs, { recursive: true });
    fs.writeFileSync(path.join(sprintAbs, '01-intent.md'), '# intent\\n');
    fs.writeFileSync(path.join(sprintAbs, '02-spec.md'), SPEC);
  });
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });`,
  publishTestDeclarations: `let root;
let origin;
let worktree;
let ghLog;
const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    chain_files: ['01-intent.md', '02-spec.md'],
    ...patch,
  });
const run = (mode, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), {
      CODING_WF_GH_BIN: FAKE_GH,
      FAKE_GH_MODE: mode,
      FAKE_GH_LOG: ghLog,
      ...extraEnv,
    });
const ghCalls = () =>
    fs.existsSync(ghLog)
      ? fs.readFileSync(ghLog, 'utf8').trim().split('\\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
const lintBody = (body) => spawnSync(
    fs.existsSync('/opt/homebrew/bin/bash') ? '/opt/homebrew/bin/bash' : 'bash',
    [path.join(HERE, 'fixtures/zenithjoy-gp-anchor/.github/workflows/scripts/lint-gp-anchor.sh')],
    { env: { ...process.env, PR_BODY: body }, encoding: 'utf8' },
  );
const REVIEW_V2 = [
    '---', 'task_id: x', 'step: spec_review', 'upstream: ["02-spec.md#S-1"]', '---', '# 规格评审', '',
    '## 评分', '意图对齐: 8', '可验证: 7', '场景覆盖: 9', '回归风险: 7', '可执行: 8', '',
    '### R-3', '针对: S-1', '严重度: 建议', 'R-3 第一行说明', 'R-3 第二行细节', '',
    '### R-4', '针对: I-1, S-2', '严重度: 重要', '场景: 用户重复提交', '依据: x.mjs', 'R-4 唯一一行', '',
  ].join('\\n');
const reviewCtx = (gan) => ({
    chain_files: ['01-intent.md', '02-spec.md', '02-review.md'],
    review_file: '02-review.md',
    review_rounds: gan.rounds,
    gan,
  });
const prBody = () => {
    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    return create[create.indexOf('--body') + 1];
  };
const BUILD_CHAIN = { chain_files: ['01-intent.md', '02-spec.md', '03-build.md'] };
const FRAG = 'changes/cp-1007000000-test.md';
const branchFiles = () => git(origin, 'ls-tree', '-r', '--name-only', 'cp-1007000000-test').trim().split('\\n');
const commitSrc = () => {
    fs.mkdirSync(path.join(worktree, 'packages/brain/src/routes'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'packages/brain/src/routes/x.js'), 'export const x = 1;\\n');
    git(worktree, 'add', '--', 'packages');
    git(worktree, 'commit', '-m', 'fix(brain): x');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# 修复 Brain 非法 id 返回 500\\n\\n### I-1\\n非法 id 返回 400\\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/03-build.md'), '# build\\n');
  };`,
  publishTestHooks: `beforeAll(() => {
    fs.chmodSync(FAKE_GH, 0o755);
  });
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
    origin = path.join(root, 'origin.git');
    worktree = path.join(root, 'wt');
    ghLog = path.join(root, 'gh.log');
    gitPlain('init', '--bare', '-b', 'main', origin);
    gitPlain('clone', origin, worktree);
    git(worktree, 'config', 'user.name', 'Test');
    git(worktree, 'config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(worktree, 'README.md'), 'hi\\n');
    git(worktree, 'add', '--', 'README.md');
    git(worktree, 'commit', '-m', 'init');
    git(worktree, 'push', '-u', 'origin', 'main');
    git(worktree, 'checkout', '-b', 'cp-1007000000-test');
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# intent\\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-spec.md'), '# spec\\n');
  });
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });`,
  runActivityProcess: `function runActivityProcess(entry, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: { ...baseEnv(), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let result = null;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = null;
      }
      resolve({ exitCode: code, stdout, stderr, result });
    });
    child.stdin.end(JSON.stringify(input));
  });
}`,
  baseEnv: `function baseEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  return env;
}`,
  runActivity: `async function runActivity(handler) {
  // stdout 只留给结果 JSON：依赖或 handler 里的 console.log 一律改道 stderr
  console.log = log;
  console.info = log;
  console.debug = log;

  let input = null;
  let result;
  try {
    input = JSON.parse(readStdin());
    result = buildResult(input, await handler(input));
  } catch (error) {
    log(error?.stack || String(error));
    result = buildResult(input, {
      status: 'failed',
      failure_class: 'fatal',
      reason_code: error?.message || 'handler_error',
    });
  }
  process.stdout.write(\`\${JSON.stringify(result)}\\n\`);
  process.exitCode = result.status === 'completed' ? 0 : 2;
}`,
  runClaude: `async function runClaude({ args: callerArgs, cwd, timeoutMs, tag, isolateRemote = false, transcriptPath, provider: selectedProvider, nativeOptions, codexEnv = {} }) {
  const provider = selectedProvider ?? process.env.CODING_WF_PROVIDER ?? 'claude';
  if (!['claude', 'codex'].includes(provider)) return { code: null, stdout: '', stderr: 'provider_unsupported', output: 'provider_unsupported', configurationError: 'provider_unsupported', provider, cost_usd: null };
  let native;
  try { if (provider === 'codex') native = prepareCodexSession({ args: callerArgs, cwd, env: { ...process.env, ...codexEnv }, nativeOptions }); }
  catch (error) { return { code: null, stdout: '', stderr: error.message, output: error.message, configurationError: error.message, provider, cost_usd: null }; }
  const args = native?.args ?? withModel(withCostOutput(callerArgs));
  const priced = (run) => ({ ...run, provider, model: provider === 'codex' ? codexEnv.CODING_WF_CODEX_MODEL || process.env.CODING_WF_CODEX_MODEL || null : process.env.CODING_WF_CLAUDE_MODEL || DEFAULT_MODEL, cost_usd: provider === 'codex' ? null : sessionCostUsd(run.stdout ?? ''), ...(transcriptPath ? { transcriptPath } : {}) });
  if (!isolateRemote && provider === 'claude') return priced(await spawnClaude({ args, cwd, timeoutMs, tag, env: claudeEnv(), transcriptPath }));
  const ghConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-wf-gh-'));
  try {
    return priced(await spawnClaude({ args, bin: native?.bin, stdin: native?.stdin, cwd, timeoutMs, tag, env: { ...remoteIsolatedEnv(ghConfigDir), ...native?.env }, transcriptPath }));
  } finally {
    fs.rmSync(ghConfigDir, { recursive: true, force: true });
  }
}`,
  loadPrompt: `function loadPrompt(name, vars) {
  return renderPrompt(fs.readFileSync(path.join(PROMPTS_DIR, \`\${name}.md\`), 'utf8'), vars);
}`,
  renderPrompt: `function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(\`{{\${key}}}\`, () => value), template);
}`,
  withModel: `function withModel(args) {
  if (args.includes('--model')) return args;
  return [...args, '--model', process.env.CODING_WF_CLAUDE_MODEL || DEFAULT_MODEL];
}`,
  openSink: `function openSink(transcriptPath, tag) {
  const toStderr = { write: (chunk) => process.stderr.write(chunk), close: () => {} };
  if (!transcriptPath) return toStderr;
  try {
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    let fd = fs.openSync(transcriptPath, 'a');
    // 收尾后管道里迟到的数据直接丢（fd 已关，写会 EBADF）
    return {
      write: (chunk) => { if (fd !== null) fs.writeSync(fd, chunk); },
      close: () => { if (fd !== null) fs.closeSync(fd); fd = null; },
    };
  } catch (error) {
    log(\`[\${tag}] 会话文件 \${transcriptPath} 打不开（\${error?.message || error}），会话输出改写 stderr\`);
    return toStderr;
  }
}`,
  claudeTimeoutMs: `function claudeTimeoutMs(budget, { envVar, defaultMs, reserveMs = 0, env = process.env }) {
  const raw = env[envVar];
  const wanted = /^[1-9][0-9]*$/.test(raw ?? '') && Number.isSafeInteger(Number(raw)) ? Number(raw) : defaultMs;
  const budgetS = budget?.max_duration_s;
  if (!Number.isFinite(budgetS) || budgetS <= 0) return wanted;
  const clamp = Math.max(1000, budgetS * 1000 - KILL_GRACE_MS - TIMEOUT_MARGIN_MS - reserveMs);
  return Math.min(wanted, clamp);
}`,
  childEnv: `function childEnv(base = process.env, { stripClaude = false } = {}) {
  const env = { ...base };
  for (const key of GIT_ENV_KEYS) delete env[key];
  if (stripClaude) {
    for (const key of Object.keys(env)) {
      if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
    }
  }
  return env;
}`,
  specIds: `function specIds(specPath) {
  if (!fs.existsSync(specPath)) return null;
  const text = fs.readFileSync(specPath, 'utf8');
  return extractAnchors(parseFrontmatter(text)?.body ?? text).filter((id) => SPEC_ID_RE.test(id));
}`,
  readStdin: `function readStdin() {
  return fs.readFileSync(0, 'utf8');
}`,
  validateBase: `function validateBase(input) {
  const taskId = input?.task_id;
  if (typeof taskId !== 'string' || taskId === '') throw new Error('task_id_missing');
  return { dir: resolveSprintDir(input.worktree, input.sprint_dir) };
}`,
  resolveSprintDir: `function resolveSprintDir(worktree, sprintDir) {
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree)) {
    throw new Error('sprint_dir_invalid');
  }
  if (typeof sprintDir !== 'string' || sprintDir === '' || path.isAbsolute(sprintDir)) {
    throw new Error('sprint_dir_invalid');
  }
  if (sprintDir.split(/[\\\\/]+/).includes('..')) {
    throw new Error('sprint_dir_invalid');
  }
  const resolved = path.join(worktree, sprintDir);
  // '.'、'./' 等解析后就是 worktree 本身：会让"只处理 sprint 目录"扩大成整个工作区
  if (path.relative(worktree, resolved) === '') {
    throw new Error('sprint_dir_invalid');
  }
  return resolved;
}`,
  headSha: `async function headSha(worktree) {
  return (await gitOut(worktree, ['rev-parse', '--verify', 'HEAD']))?.trim() || null;
}`,
  gitOut: `async function gitOut(worktree, args) {
  const { code, stdout } = await gitRun(worktree, args);
  return code === 0 ? stdout : null;
}`,
  gitRun: `function gitRun(worktree, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--literal-pathspecs', '-C', worktree, ...args],
      { env: claudeEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' && !error.killed ? error.code : null) : 0, stdout }),
    );
  });
}`,
  mainPrefix: `const { worktree, sprint_dir: sprintDir } = input;
const { dir } = validateBase(input);
const specPath = path.join(dir, SPEC_FILE);
const ids = specIds(specPath);
if (ids === null) return fail('fatal', 'spec_missing');
if (ids.length === 0) return fail('fatal', 'spec_ids_missing');
const headBefore = await headSha(worktree);
if (!headBefore) return fail('fatal', 'git_head_unavailable');
const buildPath = path.join(dir, BUILD_FILE);
const prompt = loadPrompt('build', {
    TASK_ID: input.task_id,
    SPEC_PATH: specPath,
    BUILD_PATH: buildPath,
    SPEC_IDS: ids.join(','),
    SPRINT_DIR: dir,
    REPO_RULES: repoRules(input.repo_profile),
  });
fs.rmSync(buildPath, { force: true });
const before = {
    head: headBefore,
    branch: await currentBranch(worktree),
    remote: await remoteSnapshot(worktree),
    changes: await snapshotChanges(worktree),
  };
if (before.remote === null) return fail('retryable', 'remote_check_failed', { evidence: [{ remote_before: null }] });
const args = ['-p', prompt, '--permission-mode', 'acceptEdits', ...CLAUDE_TOOLS];
const timeoutMs = claudeTimeoutMs(input.budget, TIMEOUT);
const run = await runClaude({ args, cwd: worktree, timeoutMs, tag: 'build', isolateRemote: true });`,
  spawnParameters: `function spawnClaude({ args, cwd, timeoutMs, tag, env, transcriptPath, stdin, bin = process.env.CODING_WF_CLAUDE_BIN || 'claude' }) {}`,
  spawnOuter: `const sink = openSink(transcriptPath, tag);`,
  spawnPrefix: `let output = '';
let stdout = '';
let stderr = '';
let timedOut = false;
let terminated = false;
let finished = false;
let killTimer;
let graceTimer;
let child;`,
  spawnCall: `child = spawn(bin, args, { cwd, env, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: GROUP_KILL });`,
  entry: `await runActivity(async (input) => {
  const result = await main(input);
  return { ...result, metrics: { ...(result?.metrics ?? {}), cost_usd: spend.usd } };
});`,
};

/** 额外 marker 只从所审 Git 修订读取；缺省/0 完全不添绑定。 */
export function buildSelectorEnabled(text,parse) {
  const key='EXISTING_OPS_BUILD_SELECTOR_SCHEMA';
  const declarations=parse(text).body.filter(n=>n.type==='ExportNamedDeclaration').map(n=>n.declaration)
    .filter(n=>n?.type==='VariableDeclaration').flatMap(n=>n.declarations.filter(d=>d.id?.name===key).map(d=>({kind:n.kind,value:d.init})));
  if (!declarations.length) return false;
  if (declarations.length!==1 || declarations[0].kind!=='const' || declarations[0].value?.type!=='Literal' || ![0,1].includes(declarations[0].value.value)) throw Error('build_selector_schema_unknown');
  return declarations[0].value.value===1;
}
