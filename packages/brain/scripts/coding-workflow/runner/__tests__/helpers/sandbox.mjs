// runner 测试沙箱：假 Brain HTTP、临时 bare origin + 专用 clone、以子进程运行 run-once.mjs。
import http from 'node:http';
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

const TRANSITIONS = { queued: ['in_progress'], in_progress: ['completed', 'failed'] };

/**
 * 假 Brain：tasks 为任务表（支持 status/task_type 过滤、按 created_at 降序 + limit 截断，同真 Brain）。
 * claim409 里的 id 认领返回 409；patchStatus 强制某目标状态返回指定 HTTP；
 * PATCH 按真 Brain 状态机校验（非法转移 409），终态清 claimed_by；
 * onResultPatch(task) 在只带 result 的 PATCH 后调用（模拟 Brain 重启把任务打回 queued 等）；
 * 认领对 coding-workflow-runner 强制写 kind（同真 Brain），legacyClaim=true 模拟旧端点的 COALESCE。
 */
export async function startFakeBrain({ tasks = [], claim409 = [], patchStatus = {}, onResultPatch, legacyClaim = false } = {}) {
  const state = { tasks: structuredClone(tasks), calls: [], patches: [] };
  const find = (id) => state.tasks.find((t) => t.id === id);
  const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
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
      const one = /^\/api\/brain\/tasks\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && one) {
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
      if (req.method === 'PATCH' && one) {
        const body = JSON.parse(raw);
        state.patches.push({ id: one[1], body });
        const forced = body.status ? patchStatus[body.status] : undefined;
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
        return send(res, 200, { id: one[1] });
      }
      return send(res, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => server.close(resolve));
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

/** runner 环境：全部外部依赖指向沙箱与假件。 */
export function runnerEnv(sb, brainUrl, extra = {}) {
  return {
    ...childEnv(process.env, { stripClaude: true }),
    BRAIN_URL: brainUrl,
    CODING_WF_REPO: sb.clone,
    CODING_WF_WORKTREE_BASE: sb.worktreeBase,
    CODING_WF_LOG_DIR: sb.logDir,
    CODING_WF_LOCK_DIR: sb.lockDir,
    CODING_WF_EXECUTOR: FAKE_EXECUTOR,
    CODING_WF_GH_BIN: FAKE_GH,
    CODING_WF_SKIP_NPM_CI: '1',
    // CI 修复默认关：既有用例断言 gh 调用为空；ci_fix 用例显式打开
    CODING_WF_CIFIX: '0',
    FAKE_EXEC_LOG: sb.execLog,
    FAKE_GH_LOG: sb.ghLog,
    ...extra,
  };
}

/** 以子进程运行 run-once.mjs，返回 { exitCode, stdout, stderr }。 */
export function runOnceProcess(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUN_ONCE], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
