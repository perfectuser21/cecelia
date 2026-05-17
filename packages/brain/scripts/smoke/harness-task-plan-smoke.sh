#!/usr/bin/env bash
# harness-task-plan-smoke.sh — 验证 harness_initiative pipeline task-plan.json 链路
# 端到端：构造 git fixture（裸仓 + worktree） → mock proposer push task-plan.json
#        → 调 inferTaskPlanNode → 验 tasks.length >= 1
#        → 反向：删文件 → 验返回 { error: ... }
# 不依赖 LLM，纯 JS 函数调用 + git fixture

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TMP=$(mktemp -d -t harness-smoke-XXXXXX)
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"

# 1. 起裸仓 + 工作仓
git init --bare origin.git >/dev/null
git clone -q origin.git work
cd work
git config user.email smoke@cecelia
git config user.name smoke
echo "init" > README.md
git add README.md
git commit -qm init
DEFAULT_BRANCH=$(git branch --show-current)
git push -q origin "$DEFAULT_BRANCH"

# 2. mock proposer：在新分支 cp-harness-propose-r1-smoke 写 sprints/task-plan.json + push
PROPOSE_BRANCH=cp-harness-propose-r1-smoke
git checkout -qb "$PROPOSE_BRANCH"
mkdir -p sprints
cat > sprints/task-plan.json <<EOF
{
  "initiative_id": "smoke-init",
  "journey_type": "dev_pipeline",
  "tasks": [
    { "task_id": "ws1", "title": "smoke fixture task", "scope": "noop",
      "dod": ["[BEHAVIOR] smoke 验证"], "files": ["README.md"],
      "depends_on": [], "complexity": "S", "estimated_minutes": 30 }
  ]
}
EOF
git add sprints/task-plan.json
git commit -qm "test: mock proposer push task-plan.json"
git push -q origin "$PROPOSE_BRANCH"

# 3. 正路径：调 inferTaskPlanNode，验 tasks.length >= 1
cd "$REPO_ROOT"
node --input-type=module -e "
import('$REPO_ROOT/packages/brain/src/workflows/harness-initiative.graph.js').then(async m => {
  const delta = await m.inferTaskPlanNode({
    task: { id: 'smoke-task', payload: { sprint_dir: 'sprints' } },
    taskPlan: null,
    ganResult: { propose_branch: '$PROPOSE_BRANCH' },
    worktreePath: '$TMP/work',
    initiativeId: 'smoke-init',
  });
  if (!delta.taskPlan || !Array.isArray(delta.taskPlan.tasks) || delta.taskPlan.tasks.length < 1) {
    console.error('FAIL positive: ' + JSON.stringify(delta));
    process.exit(1);
  }
  console.log('OK positive tasks=' + delta.taskPlan.tasks.length);
}).catch(e => { console.error('FAIL positive err: ' + e.message); process.exit(1); });
"

# 4. 反路径：删文件 + push --force-with-lease，验返回 { error: ... }
cd "$TMP/work"
git rm -q sprints/task-plan.json
git commit -qm "test: remove task-plan.json"
git push -q --force-with-lease origin "$PROPOSE_BRANCH"

cd "$REPO_ROOT"
node --input-type=module -e "
import('$REPO_ROOT/packages/brain/src/workflows/harness-initiative.graph.js').then(async m => {
  const delta = await m.inferTaskPlanNode({
    task: { id: 'smoke-task', payload: { sprint_dir: 'sprints' } },
    taskPlan: null,
    ganResult: { propose_branch: '$PROPOSE_BRANCH' },
    worktreePath: '$TMP/work',
    initiativeId: 'smoke-init',
  });
  if (!delta.error) {
    console.error('FAIL negative: 期望 error 字段，实际 ' + JSON.stringify(delta));
    process.exit(1);
  }
  console.log('OK negative error=' + String(delta.error).slice(0, 60));
}).catch(e => { console.error('FAIL negative err: ' + e.message); process.exit(1); });
"

echo "✅ smoke 通过：正路径 tasks ≥ 1，反路径返 error"
exit 0
