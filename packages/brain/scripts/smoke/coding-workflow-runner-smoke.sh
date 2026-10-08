#!/usr/bin/env bash
# coding workflow runner smoke：
#  ① 真 Brain 只读核对：GET /api/brain/tasks?status=queued 返回数组且条目带 payload/claimed_by
#     （runner 靠它筛 payload.coding_workflow；BRAIN_URL 未设置时跳过）
#  ② 离线全链：临时 bare origin + 专用 clone + 进程内假 Brain + 假执行器，
#     真实运行 run-once.mjs：认领 → in_progress → 建 worktree → 执行器 → completed → 删 worktree
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$BRAIN_DIR"

if [ -n "${BRAIN_URL:-}" ]; then
  curl -sf "$BRAIN_URL/api/brain/tasks?status=queued&limit=5" | node -e '
    const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!Array.isArray(rows)) throw new Error("tasks 列表不是数组");
    for (const r of rows) if (!("payload" in r) || !("claimed_by" in r)) throw new Error("条目缺 payload/claimed_by");
    console.log(`PASS 真 Brain queued 列表形状（${rows.length} 条）`);
  '
else
  echo "SKIP 未设置 BRAIN_URL，跳过真 Brain 只读核对"
fi

node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const RUNNER = path.resolve('scripts/coding-workflow/runner');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-runner-smoke-')));
const env0 = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDECODE']) delete env0[k];
const git = (...args) => execFileSync('git', args, { env: env0, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const TASK = 'eeeeeee5-0000-4000-8000-000000000005';
const patches = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify(req.url.includes('status=queued') && !patches.length
      ? [{ id: TASK, status: 'queued', task_type: 'data', claimed_by: null, created_at: new Date().toISOString(),
        payload: { coding_workflow: true, headed_manual: 'true' } }] : []));
    if (req.method === 'PATCH') patches.push(JSON.parse(raw));
    res.end(JSON.stringify({ id: TASK }));
  });
});
try {
  const origin = path.join(root, 'origin.git'), seed = path.join(root, 'seed'), clone = path.join(root, 'clone');
  git('init', '--bare', '-q', '-b', 'main', origin);
  git('init', '-q', '-b', 'main', seed);
  fs.mkdirSync(path.join(seed, 'packages/brain/scripts/coding-workflow'), { recursive: true });
  fs.copyFileSync('scripts/coding-workflow/contract.json', path.join(seed, 'packages/brain/scripts/coding-workflow/contract.json'));
  fs.writeFileSync(path.join(seed, '.gitignore'), '.dev-mode*\n.dev-lock*\n');
  git('-C', seed, 'add', '.');
  git('-C', seed, '-c', 'user.name=smoke', '-c', 'user.email=smoke@example.com', '-c', `core.hooksPath=${root}/none`, 'commit', '-q', '-m', 'seed');
  git('-C', seed, 'push', '-q', origin, 'main');
  git('clone', '-q', origin, clone);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...env0, BRAIN_URL: `http://127.0.0.1:${server.address().port}`, CODING_WF_REPO: clone,
    CODING_WF_WORKTREE_BASE: path.join(root, 'wt'), CODING_WF_LOG_DIR: path.join(root, 'logs'),
    CODING_WF_LOCK_DIR: path.join(root, 'lock'), CODING_WF_SKIP_NPM_CI: '1', CODING_WF_AUTOMERGE: '0',
    CODING_WF_EXECUTOR: path.join(RUNNER, '__tests__/fixtures/fake-executor.mjs') };
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(RUNNER, 'run-once.mjs')], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('close', resolve);
  });
  assert.equal(code, 0);
  assert.deepEqual(patches.map((p) => p.status), ['in_progress', 'completed']);
  assert.equal(patches[1].result.runner.host, os.hostname());
  assert.equal(fs.existsSync(path.join(root, 'wt', 'cw-eeeeeee5')), false);
  console.log('PASS runner 离线全链：认领→in_progress→worktree→执行器→completed→删 worktree');
} finally {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
NODE
