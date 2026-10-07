// 端到端：main 上的通用执行器 activity-contract-run.js 跑完整五活动契约。
// 假 claude / 假 gh / 本地假 Brain / 临时 bare origin，全程不碰真实服务。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../lib/protocol.mjs';
import { git, gitPlain } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.join(HERE, '..');
const RUNNER = path.join(HERE, '../../activity-contract-run.js');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const FAKE_GH = path.join(HERE, 'fixtures/fake-gh.mjs');
const contract = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'contract.json'), 'utf8'));

const TASK_ID = '11111111-2222-3333-4444-555555555555';
const BRANCH = 'cp-1007220300-coding-workflow-e2e';
const ACTIVITY_KEYS = ['intent', 'spec', 'chain_check', 'publish', 'report'];

/** 以子进程运行 CLI：stdin 写 JSON，返回 { exitCode, stdout, stderr, result }。 */
function runCli(envelope, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, '--cwd', WORKFLOW_DIR], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      let result = null;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = null;
      }
      resolve({ exitCode, stdout, stderr, result });
    });
    child.stdin.end(JSON.stringify(envelope));
  });
}

describe('coding_spec 五活动契约端到端（通用执行器 + 假外部依赖）', () => {
  let root;
  let worktree;
  let origin;
  let server;
  let brainUrl;
  let patches;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
    fs.chmodSync(FAKE_GH, 0o755);
  });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-e2e-'));
    worktree = path.join(root, 'worktree');
    origin = path.join(root, 'origin.git');
    const emptyHooks = path.join(root, 'no-hooks');
    fs.mkdirSync(emptyHooks);
    fs.mkdirSync(worktree);

    gitPlain('init', '--bare', '-q', origin);
    gitPlain('init', '-q', worktree);
    git(worktree, 'checkout', '-q', '-b', BRANCH);
    git(worktree, 'config', 'user.name', 'e2e');
    git(worktree, 'config', 'user.email', 'e2e@example.com');
    // 本机全局 pre-commit 钩子要求 .dev-mode.<branch>；同时把 hooksPath 指向空目录避免钩子干扰
    git(worktree, 'config', 'core.hooksPath', emptyHooks);
    fs.writeFileSync(path.join(worktree, `.dev-mode.${BRANCH}`), 'e2e\n');
    git(worktree, 'remote', 'add', 'origin', origin);
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'chore: init');

    patches = [];
    server = http.createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET' && req.url === `/api/brain/tasks/${TASK_ID}`) {
          res.end(JSON.stringify({
            id: TASK_ID,
            title: 'e2e 任务',
            payload: { acceptance: ['能登录', '能退出'] },
          }));
          return;
        }
        if (req.method === 'PATCH') {
          patches.push({ url: req.url, raw });
          res.end(JSON.stringify({ id: TASK_ID }));
          return;
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    brainUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('完整五活动 completed，Brain 恰好收到一次 PATCH 且 pr_url 等于 publish 输出', async () => {
    const env = {
      ...childEnv(process.env, { stripClaude: true }),
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: 'ok',
      CODING_WF_GH_BIN: FAKE_GH,
      FAKE_GH_MODE: 'new',
    };
    const input = {
      run_tag: 'e2e-rt-1',
      task_id: TASK_ID,
      worktree,
      sprint_dir: 'sprints/e2e',
      brain_url: brainUrl,
    };

    const r = await runCli({ contract, input }, env);

    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.result).not.toBeNull();
    expect(r.result.status).toBe('completed');
    expect(r.result.run_tag).toBe('e2e-rt-1');
    expect(r.result.activities.map((a) => a.key)).toEqual(ACTIVITY_KEYS);
    for (const a of r.result.activities) expect(a.status, a.key).toBe('completed');

    const publish = r.result.activities.find((a) => a.key === 'publish');
    const prUrl = publish.attempts.at(-1).outputs.pr_url;
    expect(prUrl).toBe('https://github.com/example/repo/pull/2');

    // 假 Brain：恰好一次 PATCH，只带 result.coding_workflow，不带 status
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe(`/api/brain/tasks/${TASK_ID}`);
    const body = JSON.parse(patches[0].raw);
    expect('status' in body).toBe(false);
    expect(Object.keys(body)).toEqual(['result']);
    expect(body.result.coding_workflow.pr_url).toBe(prUrl);
    expect(body.result.coding_workflow.branch).toBe(BRANCH);
    expect(body.result.coding_workflow.sprint_dir).toBe('sprints/e2e');
    expect(body.result.coding_workflow.chain_files).toEqual(['01-intent.md', '02-spec.md']);
    expect(body.result.coding_workflow.run_tag).toBe('e2e-rt-1');

    // 真实副作用：md 链落盘，分支已推到 bare origin
    expect(fs.existsSync(path.join(worktree, 'sprints/e2e/01-intent.md'))).toBe(true);
    expect(fs.existsSync(path.join(worktree, 'sprints/e2e/02-spec.md'))).toBe(true);
    expect(git(origin, 'rev-parse', '--verify', `refs/heads/${BRANCH}`).trim()).toMatch(/^[0-9a-f]{40}$/);
  }, 60000);
});
