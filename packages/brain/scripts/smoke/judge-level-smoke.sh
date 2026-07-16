#!/usr/bin/env bash
# judge-level-smoke.sh — 验证 harness-judge.js runMechanicalPreflightChecks 对 L3+curl 返回 level_evidence_mismatch
# proven-to-fire 验证法：用 node -e 直接调用函数，L3+纯curl输入必须返回 level_evidence_mismatch。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
JUDGE="$REPO_ROOT/packages/brain/src/harness-judge.js"

if [ ! -f "$JUDGE" ]; then
  echo "❌ 找不到 harness-judge.js: $JUDGE"
  exit 1
fi

fail=0

# 测试1: L3 声明 + 纯 curl 证据 → 应返回 mechFail=level_evidence_mismatch
RESULT=$(node --input-type=module <<EOF 2>&1
import { runMechanicalPreflightChecks } from '$JUDGE';
const brainResult = {
  verdict: 'PASS',
  exit_code: 0,
  log_tail: 'curl http://localhost:5221/health → 200 OK',
  verification_level: 'L3',
  behavior_tests: [
    { command: 'curl http://localhost:5221/api/brain/tasks', exit_code: 0, log_tail: 'curl http://localhost:5221/api/brain/tasks\n{"tasks":[]}' }
  ]
};
const r = runMechanicalPreflightChecks(brainResult);
console.log(JSON.stringify(r));
EOF
)

if echo "$RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d && d.mechFail === 'level_evidence_mismatch' ? 0 : 1)" 2>/dev/null; then
  echo "✅ L3+curl → level_evidence_mismatch 正确"
else
  echo "❌ L3+curl 应返回 mechFail=level_evidence_mismatch，实得: $RESULT"
  fail=1
fi

# 测试2: 存量无 verification_level → 返回 null（兼容回归）
RESULT2=$(node --input-type=module <<EOF 2>&1
import { runMechanicalPreflightChecks } from '$JUDGE';
const brainResult = {
  verdict: 'PASS',
  exit_code: 0,
  log_tail: 'npm test\n✓ all tests passed',
  behavior_tests: [
    { command: 'npm test', exit_code: 0, log_tail: '✓ 3 tests passed' }
  ]
};
const r = runMechanicalPreflightChecks(brainResult);
console.log(JSON.stringify(r));
EOF
)

if [ "$RESULT2" = "null" ]; then
  echo "✅ 存量无 verification_level → null（兼容通过）"
else
  echo "❌ 存量格式应返回 null，实得: $RESULT2"
  fail=1
fi

if [ "$fail" = "0" ]; then echo "✅ judge-level smoke 全部通过"; fi
exit $fail
