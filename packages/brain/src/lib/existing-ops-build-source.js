/** 固定 build/publish 测试的只读执行来源证明；不执行候选程序。 */
// 封套取自正式 Git 2eb4d0557365befafed1953140c9c47e20bab495。
// 仅作 AST 对照数据，不执行：runActivityProcess/baseEnv、runActivity/childEnv、
// runClaude 的 provider/isolateRemote 分支、loadPrompt/renderPrompt、withModel/openSink/claudeTimeoutMs、
// build main 至首次 runClaude 的前缀、spawnClaude 至真正 spawn 的前缀。
// 不冻结整个 build main；只允许无副作用模板变量扩展。未知结构变化失败关闭，需显式重审。
const ENVELOPES = {
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
const PREFIX = 'packages/brain/scripts/coding-workflow/';
export const BUILD_SOURCE_PATHS = Object.freeze({ test: PREFIX+'__tests__/build.test.mjs', helper: PREFIX+'__tests__/helpers/run-activity.mjs', activity: PREFIX+'activities/build.mjs', cli: PREFIX+'lib/claude.mjs', protocol: PREFIX+'lib/protocol.mjs', prompt: PREFIX+'prompts/build.md', fake: PREFIX+'__tests__/fixtures/fake-claude.mjs' });
const canonical = value => JSON.stringify(value, (key,item) => ['start','end','raw'].includes(key) ? undefined : item);
const declaration = node => node?.type === 'ExportNamedDeclaration' ? node.declaration : node;
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node,parent);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(n=>walk(n,visit,node)); else if (value && typeof value === 'object') walk(value,visit,node);
}
function nodes(node) { const result=[]; walk(node,n=>result.push(n)); return result; }
function bound(node) {
  if (!node) return [];
  if (node.type==='Identifier') return [node.name];
  if (node.type==='AssignmentPattern') return bound(node.left);
  if (node.type==='RestElement') return bound(node.argument);
  if (node.type==='ArrayPattern') return node.elements.flatMap(bound);
  if (node.type==='ObjectPattern') return node.properties.flatMap(p=>bound(p.type==='RestElement'?p.argument:p.value));
  return [];
}
const member=(n,o,p)=>n?.type==='MemberExpression'&&!n.computed&&n.object?.name===o&&n.property?.name===p;
const call=(n,name)=>n?.type==='CallExpression'&&n.callee?.name===name;
const variable=(tree,name)=>nodes(tree).filter(n=>n.type==='VariableDeclarator'&&n.id?.name===name);
const fn=(tree,name)=>tree.body.map(declaration).find(n=>n?.type==='FunctionDeclaration'&&n.id?.name===name);
const same=(a,b)=>canonical(a)===canonical(b);

/** 额外 marker 只从所审 Git 修订读取；缺省/0 完全不添绑定。 */
export function buildSelectorEnabled(text,parse) {
  const key='EXISTING_OPS_BUILD_SELECTOR_SCHEMA';
  const declarations=parse(text).body.filter(n=>n.type==='ExportNamedDeclaration').map(declaration)
    .filter(n=>n?.type==='VariableDeclaration').flatMap(n=>n.declarations.filter(d=>d.id?.name===key).map(d=>({kind:n.kind,value:d.init})));
  if (!declarations.length) return false;
  if (declarations.length!==1 || declarations[0].kind!=='const' || declarations[0].value?.type!=='Literal' || ![0,1].includes(declarations[0].value.value)) throw Error('build_selector_schema_unknown');
  return declarations[0].value.value===1;
}

/** 保护真实执行对象：拒动态全局入口、对象逃逸/变更、导入遮蔽及关键绑定再赋值。 */
function intact(tree, additional=[], allowedMutations=[], allowedEnvAliases=[]) {
  const imports=tree.body.filter(n=>n.type==='ImportDeclaration').flatMap(n=>n.specifiers.map(s=>s.local.name));
  const objects=['process','path','fs','spawn','Promise','it','describe'];
  const protectedNames=[...imports,...additional];
  const touches=n=>nodes(n).some(x=>x.type==='Identifier'&&[...objects,...protectedNames].includes(x.name));
  let ok=true;
  walk(tree,(n,parent)=>{
    if (n.type==='Identifier'&&['eval','Function','global','globalThis','Reflect'].includes(n.name)) ok=false;
    if (n.type==='MemberExpression'&&['constructor','prototype','__proto__'].includes(n.computed?n.property?.value:n.property?.name))ok=false;
    if (n.type==='VariableDeclarator'&&bound(n.id).some(name=>imports.includes(name))) ok=false;
    if(n.type==='FunctionDeclaration'&&(imports.includes(n.id?.name)||additional.includes(n.id?.name)&&!['Program','ExportNamedDeclaration'].includes(parent?.type)))ok=false;
    if(member(n,'process','env')&&!allowedEnvAliases.includes(n)) {
      const copied=parent?.type==='SpreadElement';
      const read=parent?.type==='MemberExpression'&&parent.object===n;
      const clone=call(parent,'childEnv')&&parent.arguments[0]===n;
      if(!copied&&!read&&!clone)ok=false;
    }
    if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)&&n.params.flatMap(bound).some(name=>protectedNames.includes(name)||objects.includes(name))) ok=false;
    if (n.type==='CatchClause'&&bound(n.param).some(name=>protectedNames.includes(name)||objects.includes(name))) ok=false;
    if (!allowedMutations.includes(n)&&['AssignmentExpression','UpdateExpression','UnaryExpression'].includes(n.type)&&(n.type!=='UnaryExpression'||n.operator==='delete')&&touches(n.left??n.argument)) ok=false;
    if (n.type==='CallExpression'&&n.callee?.object?.name==='Object'&&['assign','defineProperty','defineProperties','setPrototypeOf'].includes(n.callee.property?.name)) ok=false;
    if (n.type==='Identifier'&&objects.includes(n.name)) {
      const imported=parent?.type?.startsWith('Import');
      const propertyKey=parent?.type==='Property'&&parent.key===n&&!parent.computed&&!parent.shorthand;
      const memberKey=parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed;
      const read=parent?.type==='MemberExpression'&&parent.object===n&&!parent.computed;
      const invoke=['CallExpression','NewExpression'].includes(parent?.type)&&parent.callee===n&&['spawn','Promise','it','describe'].includes(n.name);
      if (!imported&&!propertyKey&&!memberKey&&!read&&!invoke) ok=false;
    }
  });
  return ok;
}
function moduleEnvelope(tree,key,parse) {
  const actualImports=tree.body.filter(n=>n.type==='ImportDeclaration').filter(n=>!(key==='activity'&&n.source.value==='../lib/spec-check.mjs'&&n.specifiers.length===1&&n.specifiers[0].imported?.name==='INTENT_FILE'&&n.specifiers[0].local.name==='INTENT_FILE'));
  const constants=tree.body.filter(n=>declaration(n)?.type==='VariableDeclaration');
  return same(actualImports,parse(ENVELOPES[key+'Imports']).body)&&same(constants,parse(ENVELOPES[key+'Constants']).body)
    && tree.body.every(n=>['ImportDeclaration','VariableDeclaration','FunctionDeclaration','ExportNamedDeclaration'].includes(n.type)||key==='activity'&&same(n,parse(ENVELOPES.entry).body[0])||['test','publishTest'].includes(key)&&call(n.expression,'describe'));
}
function functionMatches(tree,name,parse) { return same(fn(tree,name),parse(ENVELOPES[name]).body[0]); }
function registration(n) {
  if(n?.type!=='CallExpression')return false;
  if(['beforeAll','beforeEach','afterEach','it','describe'].includes(n.callee?.name))return true;
  if(n.callee?.type==='MemberExpression'&&n.callee.object?.name==='it'&&!n.callee.computed&&['skip','todo','only'].includes(n.callee.property?.name))return true;
  return n.callee?.type==='CallExpression'&&member(n.callee.callee,'it','each')&&n.callee.arguments.length===1&&n.callee.arguments[0]?.type==='ArrayExpression';
}
function testSetup(tree,key,body,parse) {
  const rootOf=n=>n?.type==='Identifier'?n.name:n?.type==='MemberExpression'?rootOf(n.object):n?.type==='CallExpression'?rootOf(n.callee):null;
  if(nodes(tree).some(n=>n.type==='MemberExpression'&&['it','describe'].includes(rootOf(n))&&(n.computed?n.property?.value:n.property?.name)==='only'))return false;
  const hooks=body.filter(n=>n.type==='ExpressionStatement'&&['beforeAll','beforeEach','afterEach'].includes(n.expression?.callee?.name));
  return same(hooks,parse(ENVELOPES[key+'Hooks']).body)&&same(body.filter(n=>n.type==='VariableDeclaration'),parse(ENVELOPES[key+'Declarations']).body);
}
function testWitness(tree,parse) {
  const top=tree.body.filter(n=>n.type==='ExpressionStatement');
  if(top.length!==1||!call(top[0].expression,'describe'))return false;
  const group=top[0].expression.arguments;
  if(group.length!==2||group[1]?.params?.length!==0||group[1]?.body?.type!=='BlockStatement')return false;
  const body=group[1].body.body;
  if(!testSetup(tree,'test',body,parse))return false;
  if(body.some(n=>!['VariableDeclaration','ExpressionStatement'].includes(n.type)))return false;
  if(body.some(n=>n.type==='ExpressionStatement'&&!registration(n.expression)))return false;
  const expected=parse(`const run=(mode,patch,extraEnv={})=>runActivityProcess(ENTRY,input(patch),{CODING_WF_PROVIDER:'claude',CODING_WF_CLAUDE_BIN:FAKE_CLAUDE,FAKE_CLAUDE_MODE:mode,...extraEnv});`).body[0].declarations[0];
  if(['HERE','ENTRY','FAKE_CLAUDE','run'].some(name=>variable(tree,name).length!==1)||!same(variable(tree,'run')[0],expected))return false;
  // 选现有参数检查用例的真实直线首语句；不借助其它任意测试/额外 env 的调用认领。
  const witness=body.find(n=>call(n.expression,'it')&&n.expression.arguments[0]?.value==='claude 参数：acceptEdits，允许 Bash，禁 git push 与 gh；prompt 带 S-n 列表与 03 路径')?.expression;
  if(!witness||witness.arguments.length!==2||witness.arguments[1]?.params?.length!==0||!witness.arguments[1].async)return false;
  const expectedCall=parse("const r=await run('build-ok');").body[0];
  return same(witness.arguments[1].body?.body?.[0],expectedCall)&&intact(tree,['HERE','ENTRY','FAKE_CLAUDE','run']);
}
function mainPrefix(tree,parse) {
  const main=fn(tree,'main');if(!main?.async||main.params.length!==1||main.params[0].name!=='input')return false;
  const index=main.body.body.findIndex(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id?.name==='run'));
  if(index<0)return false;
  const actual=structuredClone(main.body.body.slice(0,index+1));
  const prompt=variable({body:actual},'prompt');
  if(prompt.length!==1||!call(prompt[0].init,'loadPrompt')||prompt[0].init.arguments[0]?.value!=='build')return false;
  const values=prompt[0].init.arguments[1];
  if(values?.type!=='ObjectExpression'||values.properties.some(p=>p.type!=='Property'||p.computed||p.kind!=='init'||p.method))return false;
  const expected=parse(`async function main(input) {${ENVELOPES.mainPrefix}}`).body[0].body.body;
  const expectedValues=variable({body:expected},'prompt')[0].init.arguments[1];
  const keys=expectedValues.properties.map(p=>p.key.name);
  // 原模板参数保持；仅允许新增无副作用的普通值或固定 path.join(dir, CONSTANT) 参数。
  const safeValue=n=>['Literal','Identifier'].includes(n?.type)||n?.type==='MemberExpression'&&!n.computed&&n.object?.name==='input'
    ||n?.type==='CallExpression'&&member(n.callee,'path','join')&&n.arguments.length===2&&n.arguments[0]?.name==='dir'&&n.arguments[1]?.type==='Identifier';
  if(values.properties.filter(p=>!keys.includes(p.key.name)).some(p=>!safeValue(p.value)))return false;
  values.properties=values.properties.filter(p=>keys.includes(p.key.name));
  return same(actual,expected)&&variable(tree,'prompt').length===2 // precheck 独立局部 + main；不允许额外同名影子
    &&variable(tree,'args').length===1&&intact(tree,['main','prompt','args']);
}
function cliEnvelope(tree,parse) {
  if(!['runClaude','loadPrompt','renderPrompt','withModel','openSink','claudeTimeoutMs'].every(name=>functionMatches(tree,name,parse)))return false;
  const spawn=fn(tree,'spawnClaude'),parameters=parse(ENVELOPES.spawnParameters).body[0];
  if(!spawn||!same(spawn.params,parameters.params)||spawn.body.body.length!==2||!same(spawn.body.body[0],parse(ENVELOPES.spawnOuter).body[0]))return false;
  const returned=spawn.body.body[1];const promise=returned.argument;
  if(returned.type!=='ReturnStatement'||promise?.type!=='NewExpression'||promise.callee?.name!=='Promise'||promise.arguments.length!==1)return false;
  const callback=promise.arguments[0];if(callback.type!=='ArrowFunctionExpression'||callback.params.length!==1||callback.params[0].name!=='resolve')return false;
  const body=callback.body?.body;if(!body)return false;
  const prefix=parse(ENVELOPES.spawnPrefix).body;
  if(!same(body.slice(0,prefix.length),prefix)||body[prefix.length]?.type!=='TryStatement'||!same(body[prefix.length].block.body[0],parse(ENVELOPES.spawnCall).body[0]))return false;
  return intact(tree,['PROMPTS_DIR','runClaude','spawnClaude','loadPrompt','renderPrompt'],[],nodes(fn(tree,'claudeTimeoutMs')).filter(n=>member(n,'process','env')));
}
/** 只验证所登记的有限执行封套，不执行候选源码，也不承诺任意 JS 的可达性。 */
export function proveBuildSources(sources,parse) {
  try {
    const trees=Object.fromEntries(['test','helper','activity','cli','protocol'].map(k=>[k,parse(sources[k])]));
    for(const [key,tree] of Object.entries(trees))if(!moduleEnvelope(tree,key,parse))return false;
    return testWitness(trees.test,parse)&&functionMatches(trees.helper,'runActivityProcess',parse)&&functionMatches(trees.helper,'baseEnv',parse)
      &&intact(trees.helper,['runActivityProcess'])&&mainPrefix(trees.activity,parse)
      &&same(trees.activity.body.at(-1),parse(ENVELOPES.entry).body[0])&&functionMatches(trees.protocol,'runActivity',parse)&&functionMatches(trees.protocol,'childEnv',parse)
      &&intact(trees.protocol,['runActivity'],nodes(fn(trees.protocol,'runActivity')).filter(n=>n.type==='AssignmentExpression'&&member(n.left,'process','exitCode')),nodes(fn(trees.protocol,'childEnv')).filter(n=>member(n,'process','env')))&&cliEnvelope(trees.cli,parse);
  } catch { return false; }
}
export async function collectBuildSources({parse,paths,selectors,read,readSource,revision,relations,requireProof}) {
  const selected=paths.includes(BUILD_SOURCE_PATHS.test)&&selectors.include.some(p=>p.test(BUILD_SOURCE_PATHS.test))&&!selectors.exclude.some(p=>p.test(BUILD_SOURCE_PATHS.test));
  if(selected) {
  const sources=Object.fromEntries(await Promise.all(['test','helper','activity','cli','protocol'].map(async key=>[key,await readSource(BUILD_SOURCE_PATHS[key],revision)])));
  if(requireProof(proveBuildSources(sources,parse),'native_build_execution_unproven')) {
  for(const key of Object.keys(BUILD_SOURCE_PATHS))await read(BUILD_SOURCE_PATHS[key]);
  for(const [consumer,input,kind] of [['test','helper','active_build_test_helper'],['helper','activity','native_build_activity_spawn'],['activity','prompt','executed_build_prompt_input'],['cli','prompt','native_build_template_reader'],['test','fake','explicit_test_cli_environment'],['cli','fake','native_build_test_cli_spawn']])
    relations.push({consumer_path:BUILD_SOURCE_PATHS[consumer],input_path:BUILD_SOURCE_PATHS[input],kind,revision});
  }
  }
  await collectPublishSources({parse,paths,selectors,read,readSource,revision,relations,requireProof});
}

const PUBLISH_TEST=PREFIX+'__tests__/publish.test.mjs', PUBLISH_ENTRY=PREFIX+'activities/publish.mjs';
/** publish 仅证明真实 Node 入口消费，不声明其 GH 请求成功或额外 fake-GH 归属。 */
export function provePublishSources(test,helper,parse) {
  try {
    const tree=parse(test),h=parse(helper);
    if(!moduleEnvelope(tree,'publishTest',parse)||!moduleEnvelope(h,'helper',parse)||!functionMatches(h,'runActivityProcess',parse)||!functionMatches(h,'baseEnv',parse)||!intact(h,['runActivityProcess']))return false;
    const top=tree.body.filter(n=>n.type==='ExpressionStatement');
    if(top.length!==1||!call(top[0].expression,'describe'))return false;
    const group=top[0].expression.arguments;if(group.length!==2||group[1]?.params?.length!==0||group[1]?.body?.type!=='BlockStatement')return false;
    const body=group[1].body.body;
    if(!testSetup(tree,'publishTest',body,parse))return false;
    if(body.some(n=>!['VariableDeclaration','ExpressionStatement'].includes(n.type)))return false;
    if(body.some(n=>n.type==='ExpressionStatement'&&!registration(n.expression)))return false;
    const expected=parse(`const run=(mode,patch,extraEnv={})=>runActivityProcess(ENTRY,input(patch),{CODING_WF_GH_BIN:FAKE_GH,FAKE_GH_MODE:mode,FAKE_GH_LOG:ghLog,...extraEnv});`).body[0].declarations[0];
    if(['HERE','ENTRY','FAKE_GH','run'].some(name=>variable(tree,name).length!==1)||!same(variable(tree,'run')[0],expected))return false;
    const witness=body.find(n=>call(n.expression,'it')&&n.expression.arguments[0]?.value==='new：提交并推送分支，开草稿 PR，输出新 URL 与分支')?.expression;
    return Boolean(witness&&witness.arguments.length===2&&witness.arguments[1]?.params?.length===0&&witness.arguments[1].async
      &&same(witness.arguments[1].body?.body?.[0],parse("const r=await run('new');").body[0])&&intact(tree,['HERE','ENTRY','FAKE_GH','run']));
  } catch { return false; }
}
async function collectPublishSources({parse,paths,selectors,read,readSource,revision,relations,requireProof}) {
  if(!paths.includes(PUBLISH_TEST)||!selectors.include.some(p=>p.test(PUBLISH_TEST))||selectors.exclude.some(p=>p.test(PUBLISH_TEST)))return;
  if(!requireProof(provePublishSources(await readSource(PUBLISH_TEST,revision),await readSource(BUILD_SOURCE_PATHS.helper,revision),parse),'native_publish_execution_unproven'))return;
  await read(PUBLISH_TEST);await read(BUILD_SOURCE_PATHS.helper);await read(PUBLISH_ENTRY);
  relations.push({consumer_path:PUBLISH_TEST,input_path:BUILD_SOURCE_PATHS.helper,kind:'active_publish_test_helper',revision},
    {consumer_path:BUILD_SOURCE_PATHS.helper,input_path:PUBLISH_ENTRY,kind:'native_publish_activity_spawn',revision});
}
