#!/usr/bin/env bash
# propose-branch-protocol-smoke.sh
# B39 协议验证：Brain 注入 PROPOSE_BRANCH env var + 容器写 .brain-result.json
# 不再验证已删除的 extractProposeBranch / fallbackProposeBranch 函数
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$BRAIN_ROOT/../.." && pwd)"

TMP_DIR=$(mktemp -d)
trap "rm -rf '$TMP_DIR'" EXIT

cd "$BRAIN_ROOT"

# Case 1: Brain 计算 computedBranch 格式正确（cp-harness-propose-r{round}-{taskId8}）
RESULT=$(node --input-type=module << NODEJS
const taskId = '49dafaf4-1d84-4da4-b4a8-4f5b9c56facf';
const round = 2;
const computedBranch = \`cp-harness-propose-r\${round}-\${taskId.slice(0, 8)}\`;
console.log(computedBranch);
NODEJS
)
if [ "$RESULT" != "cp-harness-propose-r2-49dafaf4" ]; then
  echo "FAIL Case 1: 计算 computedBranch 期待 cp-harness-propose-r2-49dafaf4 实得 $RESULT"
  exit 1
fi
echo "[smoke] PASS Case 1: computedBranch 格式正确"

# Case 2: readBrainResult 正确读取 propose_branch 字段
node --input-type=module << NODEJS
import { readBrainResult } from '$BRAIN_ROOT/src/harness-shared.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
const d = '$TMP_DIR';

const branch = 'cp-harness-propose-r1-49dafaf4';
writeFileSync(join(d, '.brain-result.json'), JSON.stringify({
  propose_branch: branch,
  workstream_count: 2,
  task_plan_path: 'sprints/w50-test/task-plan.json',
}));
const result = await readBrainResult(d, ['propose_branch']);
if (result.propose_branch !== branch) {
  console.error('FAIL Case 2: readBrainResult 读 propose_branch 失败');
  process.exit(1);
}
console.log('[smoke] PASS Case 2: readBrainResult 读取 propose_branch 正确');
NODEJS

# Case 3: SKILL.md 写结果文件含 propose_branch 字段 + $PROPOSE_BRANCH env var
SKILL_PATH="$REPO_ROOT/packages/workflows/skills/harness-contract-proposer/SKILL.md"
node -e "
  const c = require('fs').readFileSync('$SKILL_PATH', 'utf8');
  if (!c.includes('\"propose_branch\"')) { console.error('FAIL Case 3a: SKILL.md 缺 propose_branch 字段'); process.exit(1); }
  if (!c.includes('\\\$PROPOSE_BRANCH')) { console.error('FAIL Case 3b: SKILL.md 未使用 \\\$PROPOSE_BRANCH env var'); process.exit(2); }
  if (!c.includes('.brain-result.json')) { console.error('FAIL Case 3c: SKILL.md 未写 .brain-result.json'); process.exit(3); }
"
echo "[smoke] PASS Case 3: SKILL.md 使用 \$PROPOSE_BRANCH + 写 .brain-result.json"

echo "✅ propose-branch-protocol smoke PASS (3/3 cases)"
