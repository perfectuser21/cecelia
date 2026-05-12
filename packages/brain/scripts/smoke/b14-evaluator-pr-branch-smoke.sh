#!/usr/bin/env bash
# B14 smoke — evaluateContractNode spawn env 真含 PR_BRANCH
#
# 验证：brain 加载 harness-task.graph 模块后，调 evaluateContractNode 时 spawn 的 env 必含 PR_BRANCH。
# 不依赖真 docker compose，直接在 brain 镜像内跑 node -e。
set -euo pipefail

# 在已起的 brain 容器内（CI 由 real-env-smoke job 起 cecelia-brain-smoke）跑断言
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[B14 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

# 在 brain 容器内 import graph 模块，mock spawn，断言 PR_BRANCH 透传
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { evaluateContractNode } from './src/workflows/harness-task.graph.js';

const spawnCalls = [];
const spawnDetached = async (opts) => { spawnCalls.push(opts); };
const resolveToken = async () => 'fake-token';
const poolOverride = { query: async () => ({}) };

await evaluateContractNode(
  {
    task: { id: 'b14-smoke-task', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/b14' } },
    initiativeId: 'b14-smoke-init',
    pr_url: 'https://github.com/x/y/pull/999',
    pr_branch: 'cp-b14-smoke-branch',
    contractBranch: 'cp-proposer-x',
    worktreePath: '/tmp/x',
    githubToken: 'fake-token',
    fix_round: 0,
  },
  { spawnDetached, resolveToken, poolOverride }
);

if (spawnCalls.length !== 1) {
  console.error('FAIL: expected 1 spawn call, got', spawnCalls.length);
  process.exit(1);
}
const env = spawnCalls[0].env;
if (env.PR_BRANCH !== 'cp-b14-smoke-branch') {
  console.error('FAIL: env.PR_BRANCH mismatch, expected cp-b14-smoke-branch, got', JSON.stringify(env.PR_BRANCH));
  process.exit(1);
}
if (env.PR_URL !== 'https://github.com/x/y/pull/999') {
  console.error('FAIL: env.PR_URL mismatch');
  process.exit(1);
}
console.log('[B14 smoke] PASS — evaluator spawn env.PR_BRANCH 真传');
" || { echo "[B14 smoke] FAIL — assertion in brain container failed"; exit 1; }
