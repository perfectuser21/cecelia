// runner 测试沙箱：假 Brain HTTP、临时 bare origin + 专用 clone、以子进程运行 run-once.mjs。
import { startTestBrain } from '../../../__tests__/helpers/brain-transport.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../../../lib/protocol.mjs';
import { git, gitPlain } from '../../../__tests__/helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUN_ONCE = path.join(HERE, '../../run-once.mjs');
export const FAKE_EXECUTOR = path.join(HERE, '../fixtures/fake-executor.mjs');
export const FAKE_GH = path.join(HERE, '../fixtures/fake-gh.mjs');
const CONTRACT = path.join(HERE, '../../../contract.json');

const transports = new Map();
const TRANSITIONS = { queued: ['in_progress'], in_progress: ['completed', 'failed'] };

/**
 * 假 Brain：tasks 为任务表（支持 status/task_type 过滤、按 created_at 降序 + limit 截断，同真 Brain）。
 * claim409 里的 id 认领返回 409；patchStatus 强制某目标状态返回指定 HTTP；
 * PATCH 按真 Brain 状态机校验（非法转移 409），终态清 claimed_by；
 * onResultPatch(task) 在只带 result 的 PATCH 后调用（模拟 Brain 重启把任务打回 queued 等）；
 * 认领对 coding-workflow-runner 强制写 kind（同真 Brain），legacyClaim=true 模拟旧端点的 COALESCE。
 */
export async function startFakeBrain({ tasks = [], claim409 = [], patchStatus = {}, onResultPatch, legacyClaim = false, internalToken = null, heartbeatStatus = null, getTaskStatus = null, resultPatchStatus = null, learningStatus = null, resultPatchCommittedStatus = null } = {}) {
  const state = { tasks: structuredClone(tasks), calls: [], patches: [], learnings: [], learningRows: [], spans: [], heartbeats: [] };

  const find = (id) => state.tasks.find((t) => t.id === id);
  const send = (_res, status, body) => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const transport = await startTestBrain((req) => {
      const raw = req.body;
      const res = null;
      const url = new URL(req.url, 'http://x');
      state.calls.push({ method: req.method, path: url.pathname, query: url.search, raw });
      if (req.method === 'GET' && url.pathname === '/api/brain/tasks') {
        const q = url.searchParams;
        const rows = state.tasks
          .filter((t) => (!q.get('status') || t.status === q.get('status')) && (!q.get('task_type') || t.task_type === q.get('task_type')))
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .slice(0, Number(q.get('limit') || 100));
        return send(res, 200, rows);
      }
      // 执行记录（决策 b34e346a）：同真 Brain 的 POST /api/brain/spans（单条或数组）
      if (req.method === 'POST' && url.pathname === '/api/brain/spans') {
        // 同真 Brain 的 internalAuthOrLoopback：配了令牌就必须带 X-Internal-Token / Bearer
        const provided = req.headers['x-internal-token'] || String(req.headers.authorization || '').replace(/^Bearer /, '');
        if (internalToken && provided !== internalToken) return send(res, 401, { error: { code: 'UNAUTHORIZED' } });
        const body = JSON.parse(raw);
        state.spans.push(...(Array.isArray(body) ? body : [body]));
        return send(res, 201, { inserted: Array.isArray(body) ? body.length : 1 });
      }
      // learnings 落库（审计 #22）：同真 Brain 的 POST /api/brain/learnings-received
      if (req.method === 'POST' && url.pathname === '/api/brain/learnings-received') {
        if (learningStatus) return send(res, learningStatus, { error: 'forced' });
        const body = JSON.parse(raw);
        state.learnings.push(body);
        const ids = body.next_steps_suggested.map((content) => {
          const id = `learning-${state.learningRows.length + 1}`;
          state.learningRows.push({ id, content });
          return id;
        });
        return send(res, 200, { success: true, tasks_created: 0, task_ids: [], learnings_inserted: ids.length, learning_ids: ids });
      }
      if (req.method === 'GET' && url.pathname === '/api/brain/learnings') {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        return send(res, 200, { learnings: state.learningRows.slice(offset, offset + limit), total: state.learningRows.length });
      }
      const one = /^\/api\/brain\/tasks\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && one) {
        if (getTaskStatus) return send(res, getTaskStatus, { error: 'forced' });
        const task = find(one[1]);
        return task ? send(res, 200, task) : send(res, 404, { error: 'Task not found' });
      }
      const claim = /^\/api\/brain\/tasks\/([^/]+)\/claim$/.exec(url.pathname);
      if (req.method === 'POST' && claim) {
        const task = find(claim[1]);
        if (!task) return send(res, 404, { error: 'Task not found' });
        if (claim409.includes(claim[1]) || task.claimed_by) return send(res, 409, { error: 'Task already claimed' });
        const body = JSON.parse(raw);
        task.claimed_by = body.claimer;
        const force = !legacyClaim && body.executor_kind === 'coding-workflow-runner';
        task.executor_kind = force ? body.executor_kind : (task.executor_kind ?? body.executor_kind ?? 'headed-session');
        return send(res, 200, { id: task.id, claimed_by: task.claimed_by, executor_kind: task.executor_kind });
      }
      // 统一领单租约心跳（任务 c5f6e683）：heartbeatStatus(n) 决定第 n 次心跳的 HTTP；未配置 = 旧 Brain 没有该端点（404）
      const hb = /^\/api\/brain\/tasks\/([^/]+)\/heartbeat$/.exec(url.pathname);
      if (req.method === 'POST' && hb && heartbeatStatus) {
        state.heartbeats.push(JSON.parse(raw));
        const code = heartbeatStatus(state.heartbeats.length);
        return send(res, code, code === 200 ? { ok: true } : { error: 'lease_lost' });
      }
      if (req.method === 'PATCH' && one) {

        const body = JSON.parse(raw);
        state.patches.push({ id: one[1], body });
        const forced = body.status ? patchStatus[body.status] : (body.result?.merge ? resultPatchStatus : undefined);
        if (forced) return send(res, forced, { code: 'FORCED' });
        const task = find(one[1]);
        if (!task) return send(res, 404, { code: 'TASK_NOT_FOUND' });
        if (body.status && body.status !== task.status && !(TRANSITIONS[task.status] || []).includes(body.status)) {
          return send(res, 409, { code: 'INVALID_TRANSITION', current_status: task.status });
        }
        if (body.status) task.status = body.status;
        if (['completed', 'failed'].includes(body.status)) task.claimed_by = null;
        if (body.result) task.result = { ...(task.result || {}), ...body.result };
        if (!body.status && onResultPatch) onResultPatch(task);
        if (body.result?.merge && resultPatchCommittedStatus) return send(res, resultPatchCommittedStatus, { code: 'ACK_LOST_AFTER_COMMIT' });
        return send(res, 200, { id: one[1] });
      }
      return send(res, 404, {});
  });
  state.url = transport.url;
  transports.set(state.url, transport);
  state.close = async () => { transports.delete(state.url); await transport.close(); };
  return state;
}

/** 开关三件套中 payload 的两项（另一项是 task_type: 'data'）。 */
export const SWITCH = { coding_workflow: true, headed_manual: 'true' };

/** 生成一条带开关的 queued 任务。 */
export function codingTask(id, extra = {}) {
  return {
    id,
    title: `任务 ${id.slice(0, 8)}`,
    status: 'queued',
    task_type: 'data',
    claimed_by: null,
    executor_kind: null,
    created_at: '2026-10-08T00:00:00.000Z',
    payload: { ...SWITCH },
    ...extra,
  };
}

/**
 * 临时目录：bare origin（main 上有真实 contract.json 与忽略 .dev-* 的 .gitignore）、
 * 专用 clone、worktree base、日志与锁目录。
 */
export function makeSandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-runner-')));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const clone = path.join(root, 'clone');
  gitPlain('init', '--bare', '-q', '-b', 'main', origin);
  gitPlain('init', '-q', '-b', 'main', seed);
  git(seed, 'config', 'user.name', 'seed');
  git(seed, 'config', 'user.email', 'seed@example.com');
  git(seed, 'config', 'core.hooksPath', path.join(root, 'no-hooks'));
  const wfDir = path.join(seed, 'packages/brain/scripts/coding-workflow');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.copyFileSync(CONTRACT, path.join(wfDir, 'contract.json'));
  fs.writeFileSync(path.join(seed, '.gitignore'), '.dev-mode*\n.dev-lock*\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'chore: seed');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  gitPlain('clone', '-q', origin, clone);
  return {
    root,
    origin,
    seed,
    clone,
    worktreeBase: path.join(root, 'wt'),
    logDir: path.join(root, 'logs'),
    lockDir: path.join(root, 'lock'),
    execLog: path.join(root, 'exec.log'),
    ghLog: path.join(root, 'gh.log'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * 测试用干净环境：在 childEnv 基础上再剥掉所有 CODING_WF_*（childEnv 为生产语义保留它们），
 * 避免外部变量泄漏进被测子进程；不修改 base。
 */
export function cleanTestEnv(base = process.env, opts) {
  const env = childEnv(base, opts);
  for (const key of Object.keys(env)) {
    if (key.startsWith('CODING_WF_')) delete env[key];
  }
  return env;
}

/** runner 环境：全部外部依赖指向沙箱与假件。 */
export function runnerEnv(sb, brainUrl, extra = {}) {
  // 通用fixture真身是本地x/y；self来源门用例显式提供Cecelia配置。
  const reposPath = path.join(sb.root, 'fixture-repos.json');
  const repos = JSON.parse(fs.readFileSync(path.join(HERE, '../../../repos.json'), 'utf8'));
  const primary = repos.repos.find(r => r.default);
  primary.slug = 'x/y'; primary.origin = 'https://github.com/x/y.git';
  fs.writeFileSync(reposPath, JSON.stringify(repos));
  return {
    ...cleanTestEnv(process.env, { stripClaude: true }),
    BRAIN_URL: brainUrl,
    CODING_WF_REPOS_FILE: reposPath,
    CODING_WF_REPO: sb.clone,
    CODING_WF_WORKTREE_BASE: sb.worktreeBase,
    CODING_WF_LOG_DIR: sb.logDir,
    CODING_WF_LOCK_DIR: sb.lockDir,
    CODING_WF_EXECUTOR: FAKE_EXECUTOR,
    CODING_WF_GH_BIN: FAKE_GH,
    CODING_WF_SKIP_NPM_CI: '1',
    // CI 修复默认关：既有用例断言 gh 调用为空；ci_fix 用例显式打开
    CODING_WF_CIFIX: '0',
    // QA 门默认关：既有用例按「开 PR 即自动合并」断言；QA 门用例显式打开
    CODING_WF_QA_GATE: '0',
    // coding commander 默认关：既有用例断言升级后不再处理；commander 用例显式打开
    CODING_WF_COMMANDER: '0',
    // 空闲日志限频关闭（0 = 每轮都打）：既有用例断言「没有可新跑的开关任务」；限频用例显式设置
    CODING_WF_IDLE_LOG_INTERVAL_MS: '0',
    FAKE_EXEC_LOG: sb.execLog,
    FAKE_GH_LOG: sb.ghLog,
    ...extra,
  };
}

/** 以子进程运行 run-once.mjs，返回 { exitCode, stdout, stderr }。 */
export function runOnceProcess(env) {
  return new Promise((resolve, reject) => {
    const options = transports.get(env.BRAIN_URL)?.spawnOptions() ?? { args: [], stdio: ['ignore', 'pipe', 'pipe'], attach() {} };
    const args = [...options.args];
    if (args.length) {
      const relay = new URL('../fixtures/executor-ipc-preload.mjs', import.meta.url);
      relay.searchParams.set('fetchPreload', args[1]);
      relay.searchParams.set('executor', FAKE_EXECUTOR);
      args.push('--import', relay.href);
    }
    const child = spawn(process.execPath, [...args, RUN_ONCE], { env, stdio: options.stdio });
    options.attach(child);
    child.stdin?.end();
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/** 读 JSON 行日志文件；不存在返回 []。 */
export function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
