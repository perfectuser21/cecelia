#!/usr/bin/env bash
# infer-task-plan-fetch-smoke.sh
# 真环境验证：模拟 task container push origin → brain 端 inferTaskPlan 调用 → 能 git show 到 task-plan.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORK=$(mktemp -d -t infer-fetch-smoke-XXXXXX)
trap "rm -rf '$WORK'" EXIT

# Setup: 模拟 origin (bare repo) + 两个 worktree (proposer-side + brain-side)
git init --bare "$WORK/origin.git" >/dev/null 2>&1
git clone "$WORK/origin.git" "$WORK/proposer" >/dev/null 2>&1
git clone "$WORK/origin.git" "$WORK/brain" >/dev/null 2>&1

# proposer-side: 写 task-plan.json，commit，push 一个新分支
cd "$WORK/proposer"
git config user.email "test@test"
git config user.name "Test"
mkdir -p sprints/test-sprint
cat > sprints/test-sprint/task-plan.json <<'EOF'
{"initiative_id":"smoke-test","journey_type":"autonomous","journey_type_reason":"smoke","tasks":[{"task_id":"ws1","title":"t","scope":"s","dod":["[BEHAVIOR] x"],"files":["a.js"],"depends_on":[],"complexity":"S","estimated_minutes":30}]}
EOF
git checkout -b cp-harness-propose-r1-smokeABC >/dev/null 2>&1
git add . && git commit -m "test" --quiet
git push origin cp-harness-propose-r1-smokeABC --quiet 2>&1

# brain-side: 起步 main 分支，没 fetch 过 cp-harness-propose-r1-smokeABC
cd "$WORK/brain"
git config user.email "test@test"
git config user.name "Test"

# 验证：brain-side 此时 git show 应该 fail（没 fetch）
if ! git show "origin/cp-harness-propose-r1-smokeABC:sprints/test-sprint/task-plan.json" >/dev/null 2>&1; then
  echo "✓ brain-side 起始状态：未 fetch → git show fail（符合预期）"
else
  echo "FAIL: brain-side 起始状态意外能 git show，smoke 假设错"
  exit 1
fi

# 通过 inferTaskPlanNode（指向 brain-side 这个 worktree）调用，看是否能拿到 task-plan
RESULT=$(node --input-type=module -e "
  process.chdir('$WORK/brain');
  const m = await import('$BRAIN_ROOT/src/workflows/harness-initiative.graph.js');
  const result = await m.inferTaskPlanNode({
    worktreePath: '$WORK/brain',
    initiativeId: 'smoke-test',
    task: { payload: { sprint_dir: 'sprints/test-sprint' } },
    ganResult: { propose_branch: 'cp-harness-propose-r1-smokeABC' },
  });
  if (result.error) { console.error('NODE_ERROR:' + result.error); process.exit(1); }
  if (!result.taskPlan?.tasks?.length) { console.error('NO_TASKS'); process.exit(2); }
  console.log('OK:tasks=' + result.taskPlan.tasks.length);
" 2>&1)

if [[ "$RESULT" == *"OK:tasks=1"* ]]; then
  echo "✅ infer-task-plan-fetch smoke PASS — brain 自动 fetch 后能 git show"
  exit 0
else
  echo "❌ smoke FAIL: $RESULT"
  exit 1
fi
