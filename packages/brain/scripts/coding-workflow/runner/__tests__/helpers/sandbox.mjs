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

/**
 * 假 Brain：tasks 为 queued 列表；claim409 里的 id 认领返回 409。
 * 记录所有请求到 calls，PATCH 同时记到 patches 并更新内存状态。
 */
export async function startFakeBrain({ tasks = [], claim409 = [], patchStatus = {} } = {}) {
  const state = { tasks: structuredClone(tasks), calls: [], patches: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const url = new URL(req.url, 'http://x');
      state.calls.push({ method: req.method, path: url.pathname, query: url.search, raw });
      if (req.method === 'GET' && url.pathname === '/api/brain/tasks') {
        const status = url.searchParams.get('status');
        res.end(JSON.stringify(state.tasks.filter((t) => !status || t.status === status)));
        return;
      }
      const claim = /^\/api\/brain\/tasks\/([^/]+)\/claim$/.exec(url.pathname);
      if (req.method === 'POST' && claim) {
        const task = state.tasks.find((t) => t.id === claim[1]);
        if (claim409.includes(claim[1]) || task?.claimed_by) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: 'Task already claimed' }));
          return;
        }
        task.claimed_by = JSON.parse(raw).claimer;
        res.end(JSON.stringify({ id: task.id, claimed_by: task.claimed_by }));
        return;
      }
      const patch = /^\/api\/brain\/tasks\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'PATCH' && patch) {
        const body = JSON.parse(raw);
        state.patches.push({ id: patch[1], body });
        const forced = body.status ? patchStatus[body.status] : undefined;
        if (forced) {
          res.statusCode = forced;
          res.end(JSON.stringify({ code: 'FORCED' }));
          return;
        }
        const task = state.tasks.find((t) => t.id === patch[1]);
        if (task && body.status) task.status = body.status;
        if (task && body.result) task.result = { ...(task.result || {}), ...body.result };
        res.end(JSON.stringify({ id: patch[1] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => server.close(resolve));
  return state;
}

/** 生成一条带开关的 queued 任务。 */
export function codingTask(id, extra = {}) {
  return {
    id,
    title: `任务 ${id.slice(0, 8)}`,
    status: 'queued',
    task_type: 'data',
    claimed_by: null,
    created_at: '2026-10-08T00:00:00.000Z',
    payload: { coding_workflow: true, headed_manual: 'true' },
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
