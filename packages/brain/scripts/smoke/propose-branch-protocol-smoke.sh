#!/usr/bin/env bash
# propose-branch-protocol-smoke.sh
# 真环境验证：propose_branch 协议 fallback 函数命中实际 SKILL push 格式
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$BRAIN_ROOT/../.." && pwd)"

cd "$BRAIN_ROOT"

# Case 1: extractProposeBranch 命中 SKILL JSON 输出
RESULT=$(node --input-type=module -e "
  import('./src/workflows/harness-gan.graph.js').then(m => {
    const out = m.extractProposeBranch('logs\n{\"verdict\":\"PROPOSED\",\"propose_branch\":\"cp-harness-propose-r1-deadbeef\"}\n');
    console.log(out);
  });
")
if [ "$RESULT" != "cp-harness-propose-r1-deadbeef" ]; then
  echo "FAIL Case 1: extractProposeBranch 期待 cp-harness-propose-r1-deadbeef 实得 $RESULT"
  exit 1
fi

# Case 2: fallbackProposeBranch 跟 SKILL Step 4 push 格式 cp-harness-propose-r{N}-{taskIdSlice} 一致
RESULT=$(node --input-type=module -e "
  import('./src/workflows/harness-gan.graph.js').then(m => {
    const out = m.fallbackProposeBranch('49dafaf4-1d84-4da4-b4a8-4f5b9c56facf', 2);
    console.log(out);
  });
")
if [ "$RESULT" != "cp-harness-propose-r2-49dafaf4" ]; then
  echo "FAIL Case 2: fallbackProposeBranch 期待 cp-harness-propose-r2-49dafaf4 实得 $RESULT"
  exit 1
fi

# Case 3: SKILL.md 文件含 propose_branch JSON 输出 + 不含限定词 "GAN APPROVED 后"
SKILL_PATH="$REPO_ROOT/packages/workflows/skills/harness-contract-proposer/SKILL.md"
node -e "
  const c = require('fs').readFileSync('$SKILL_PATH', 'utf8');
  if (!c.includes('\"propose_branch\"')) { console.error('FAIL Case 3a: SKILL.md 缺 propose_branch 输出契约'); process.exit(1); }
  if (c.includes('GAN APPROVED 后')) { console.error('FAIL Case 3b: SKILL.md 仍含限定词 GAN APPROVED 后'); process.exit(2); }
"

echo "✅ propose-branch-protocol smoke PASS (3/3 cases)"
