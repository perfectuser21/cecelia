#!/usr/bin/env bash
# lint-no-mock-only-test-cases.sh — 自跑验证 lint-no-mock-only-test.sh 规则
#
# 4 case：
#   A. heavy mock + 无配套 → expect FAIL
#   B. heavy mock + smoke.sh → expect PASS
#   C. heavy mock + integration test → expect PASS
#   D. light mock (5) → expect PASS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-no-mock-only-test.sh"

if [ ! -x "$LINT" ]; then
  echo "FATAL: lint not found / not executable: $LINT"
  exit 1
fi

PASSED=0
FAILED=0

run_case() {
  local name="$1" expect_fail="$2" content="$3" extra_files="${4:-}"

  local TMPDIR
  TMPDIR=$(mktemp -d)
  cd "$TMPDIR" || return 1
  git init -q
  git config user.email "test@local"
  git config user.name "test"
  git config commit.gpgsign false
  mkdir -p packages/brain/src/__tests__ packages/brain/scripts/smoke
  echo "export const foo = 1;" > packages/brain/src/foo.js
  git add packages/brain/src/foo.js
  git commit -q -m "base"
  git branch -M main

  git checkout -q -b "case-$name"
  echo "$content" > "packages/brain/src/__tests__/${name}.test.js"
  git add "packages/brain/src/__tests__/${name}.test.js"
  if [ -n "$extra_files" ]; then
    eval "$extra_files"
  fi
  git add -A
  git commit -q -m "$name"

  bash "$LINT" main >/tmp/lint-no-mock-out.txt 2>&1
  local rc=$?

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] 正确拒（exit $rc）"
    PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] 正确放（exit 0）"
    PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got rc=$rc"
    cat /tmp/lint-no-mock-out.txt
    FAILED=$((FAILED+1))
  fi

  cd /tmp
  rm -rf "$TMPDIR"
}

# 生成 vi.mock × N 的内容
gen_mocks() {
  local n=$1
  for i in $(seq 1 "$n"); do
    echo "vi.mock('../mod${i}.js', () => ({ default: vi.fn() }));"
  done
}

# Case A: 35 mock + 无配套 → FAIL
A_CONTENT="import { describe, it, expect, vi } from 'vitest';
$(gen_mocks 35)
describe('heavy-mock', () => {
  it('test', async () => {
    const m = await import('../foo.js');
    expect(m).toBeDefined();
  });
});"
run_case "heavy-no-cover" 1 "$A_CONTENT"

# Case B: 35 mock + smoke.sh → PASS
B_CONTENT="$A_CONTENT"
run_case "heavy-with-smoke" 0 "$B_CONTENT" 'echo "#!/bin/bash" > packages/brain/scripts/smoke/heavy-with-smoke-smoke.sh && chmod +x packages/brain/scripts/smoke/heavy-with-smoke-smoke.sh'

# Case C: 35 mock + integration test → PASS
C_CONTENT="$A_CONTENT"
run_case "heavy-with-integ" 0 "$C_CONTENT" 'mkdir -p packages/brain/src/__tests__/integration && echo "import { describe, it, expect } from \"vitest\"; describe(\"i\", () => { it(\"x\", () => expect(1).toBe(1)) });" > packages/brain/src/__tests__/integration/heavy-integ.test.js'

# Case D: light mock (5) → PASS
D_CONTENT="import { describe, it, expect, vi } from 'vitest';
$(gen_mocks 5)
describe('light-mock', () => {
  it('test', async () => {
    const m = await import('../foo.js');
    expect(m).toBeDefined();
  });
});"
run_case "light-mock" 0 "$D_CONTENT"

echo ""
echo "lint-no-mock-only-test-cases: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
