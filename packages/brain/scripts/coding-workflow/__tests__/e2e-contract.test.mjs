// 端到端：main 上的通用执行器 activity-contract-run.js 跑完整七活动契约。
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
const ACTIVITY_KEYS = ['intent', 'spec', 'build', 'verify', 'chain_check', 'publish', 'report'];
const CHAIN_FILES = ['01-intent.md', '02-spec.md', '03-build.md', '04-evidence.md'];

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

describe('coding_spec 七活动契约端到端（通用执行器 + 假外部依赖）', () => {
  let root;
  let worktree;
  let origin;
  let server;
  let brainUrl;
  let patches;
  let ghLog;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
    fs.chmodSync(FAKE_GH, 0o755);
  });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-e2e-'));
    worktree = path.join(root, 'worktree');
    origin = path.join(root, 'origin.git');
    ghLog = path.join(root, 'gh.log');
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

  const envFor = (verifyMode) => ({
    ...childEnv(process.env, { stripClaude: true }),
    CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_MODE: 'ok',
    FAKE_CLAUDE_MODE_BUILD: 'build-ok',
    FAKE_CLAUDE_MODE_VERIFY: verifyMode,
    CODING_WF_GH_BIN: FAKE_GH,
    FAKE_GH_MODE: 'new',
    FAKE_GH_LOG: ghLog,
  });
  const runInput = () => ({
    run_tag: 'e2e-rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/e2e',
    brain_url: brainUrl,
  });
  const ghCalls = () => (fs.existsSync(ghLog)
    ? fs.readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);

  it('完整七活动 completed：build 真实提交、verify 全 PASS，PR 正文含验收摘要，Brain 恰好收到一次 PATCH', async () => {
    const r = await runCli({ contract, input: runInput() }, envFor('verify-pass'));

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
    expect(body.result.coding_workflow.chain_files).toEqual(CHAIN_FILES);
    expect(body.result.coding_workflow.run_tag).toBe('e2e-rt-1');

    // build 的提交与 verify 的验收结果进了上下文
    const build = r.result.activities.find((a) => a.key === 'build').attempts.at(-1).outputs;
    expect(build.build_file).toBe('03-build.md');
    expect(build.build_commits).toHaveLength(1);
    expect(r.result.outputs.verified_ids).toEqual(['I-1', 'I-2']);
    // md 链指纹贯穿全程，build/verify 的防篡改检查都实际比对过
    expect(r.result.outputs.intent_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.result.outputs.spec_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(worktree, 'sprints/e2e/03-build.md'))).toBe(true);

    // PR 正文：md 链 + 每条 I-n 的验收摘要
    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    expect(create[create.indexOf('--title') + 1]).toBe('feat(workflow): e2e 任务');
    const prBody = create[create.indexOf('--body') + 1];
    expect(prBody).toContain('- sprints/e2e/04-evidence.md');
    expect(prBody).toContain('- I-1：PASS');
    expect(prBody).toContain('- I-2：PASS');

    // 真实副作用：代码提交与四文件 md 链都已推到 bare origin
    const pushed = git(origin, 'ls-tree', '-r', '--name-only', BRANCH).trim().split('\n');
    expect(pushed).toContain('src/feature.js');
    for (const f of CHAIN_FILES) expect(pushed).toContain(`sprints/e2e/${f}`);
    expect(git(origin, 'log', '--format=%H', BRANCH)).toContain(build.build_commits[0]);
  }, 60000);

  it('verify 判 FAIL：链停在 verify，chain_check/publish 不执行，report 仍执行并把失败证据回写 Brain', async () => {
    const r = await runCli({ contract, input: runInput() }, envFor('verify-fail'));

    expect(r.result, r.stderr).not.toBeNull();
    // intent/spec/build 已有产出 -> partial（执行器语义），CLI 退出码 2
    expect(r.result.status).toBe('partial');
    expect(r.exitCode).toBe(2);
    expect(r.result.activities.map((a) => a.key)).toEqual(['intent', 'spec', 'build', 'verify', 'report']);

    const verify = r.result.activities.find((a) => a.key === 'verify');
    expect(verify.status).toBe('failed');
    expect(verify.attempts).toHaveLength(1);
    const attempt = verify.attempts[0];
    expect(attempt.failure_class).toBe('fatal');
    expect(attempt.reason_code).toBe('verification_failed');
    const failure = {
      failed: [{ id: 'E-2', covers: ['I-2'], command: 'npm test -- I-2', output: 'AssertionError: expected 500 to be 200' }],
      verdicts: [{ intent: 'I-1', verdict: 'PASS' }, { intent: 'I-2', verdict: 'FAIL' }],
    };
    expect(attempt.evidence).toEqual([failure]);
    expect(r.result.evidence).toContainEqual(failure);

    // verify 的失败结论进了上下文，finalize 的 report 仍执行并把失败条目回写 Brain
    expect(r.result.outputs.verification.reason_code).toBe('verification_failed');
    const report = r.result.activities.find((a) => a.key === 'report');
    expect(report.status).toBe('completed');
    expect(patches).toHaveLength(1);
    const cw = JSON.parse(patches[0].raw).result.coding_workflow;
    expect(cw.status).toBe('failed');
    expect(cw.run_tag).toBe('e2e-rt-1');
    expect(cw.sprint_dir).toBe('sprints/e2e');
    expect(cw.verification.failed).toEqual([
      { id: 'E-2', covers: ['I-2'], command: 'npm test -- I-2', output_tail: 'AssertionError: expected 500 to be 200' },
    ]);

    // publish 没有执行：没调 gh，分支没推到 origin
    expect(ghCalls()).toHaveLength(0);
    expect(() => git(origin, 'rev-parse', '--verify', `refs/heads/${BRANCH}`)).toThrow();
    expect(fs.existsSync(path.join(worktree, 'sprints/e2e/04-evidence.md'))).toBe(true);
  }, 60000);
});
