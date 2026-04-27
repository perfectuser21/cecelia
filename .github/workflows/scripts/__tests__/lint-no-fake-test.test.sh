#!/usr/bin/env bash
# lint-no-fake-test.test.sh — 自跑验证 lint-no-fake-test.sh 规则
#
# 7 case：
#   A. 全 toBeDefined         → expect FAIL  (Rule 1)
#   B. 全 toEqual(null|undef) → expect FAIL  (Rule 1)
#   C. 全 not.toThrow         → expect FAIL  (Rule 1)
#   D. 6 mock + 2 expect      → expect FAIL  (Rule 2)
#   E. 真行为断言（toBe）     → expect PASS
#   F. 弱+强混合              → expect PASS
#   G. 0 expect               → expect PASS（由 lint-test-quality 接管）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-no-fake-test.sh"

if [ ! -f "$LINT" ]; then
  echo "FATAL: lint not found: $LINT"
  exit 1
fi

PASSED=0
FAILED=0

run_case() {
  local name="$1" expect_fail="$2" content="$3"

  local TMPDIR
  TMPDIR=$(mktemp -d)
  cd "$TMPDIR" || return 1
  git init -q
  git config user.email "test@local"
  git config user.name "test"
  git config commit.gpgsign false
  mkdir -p src/__tests__
  echo "export const foo = 1;" > src/foo.js
  git add src/foo.js
  git commit -q -m "base"
  git branch -M main

  git checkout -q -b "case-$name"
  printf '%s\n' "$content" > "src/__tests__/${name}.test.js"
  git add "src/__tests__/${name}.test.js"
  git commit -q -m "$name"

  bash "$LINT" main >/tmp/lint-no-fake-out.txt 2>&1
  local rc=$?

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] 正确拒（exit $rc）"
    PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] 正确放（exit 0）"
    PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got rc=$rc"
    cat /tmp/lint-no-fake-out.txt
    FAILED=$((FAILED+1))
  fi

  cd /tmp
  rm -rf "$TMPDIR"
}

# Case A: 全 toBeDefined → FAIL (Rule 1)
read -r -d '' WEAK_DEFINED <<'EOF' || true
import { describe, it, expect } from 'vitest';
import { foo } from '../foo.js';
describe('weak-defined', () => {
  it('exists', () => {
    expect(foo).toBeDefined();
    expect(foo).toBeDefined();
  });
});
EOF
run_case "weak-defined" 1 "$WEAK_DEFINED"

# Case B: 全 toEqual(null) / toEqual(undefined) → FAIL (Rule 1)
read -r -d '' WEAK_NULL <<'EOF' || true
import { describe, it, expect } from 'vitest';
describe('weak-null', () => {
  it('null/undefined', () => {
    expect(null).toEqual(null);
    expect(undefined).toEqual(undefined);
    expect(null).toBeNull();
  });
});
EOF
run_case "weak-null" 1 "$WEAK_NULL"

# Case C: 全 not.toThrow → FAIL (Rule 1)
read -r -d '' WEAK_NO_THROW <<'EOF' || true
import { describe, it, expect } from 'vitest';
import { foo } from '../foo.js';
describe('weak-no-throw', () => {
  it('does not throw', () => {
    expect(() => foo).not.toThrow();
    expect(() => foo + 1).not.toThrow();
  });
});
EOF
run_case "weak-no-throw" 1 "$WEAK_NO_THROW"

# Case D: 6 mock + 2 expect → FAIL (Rule 2)
MOCK_LINES=""
for i in 1 2 3 4 5 6; do
  MOCK_LINES="${MOCK_LINES}vi.mock('../mod${i}.js', () => ({ default: vi.fn() }));"$'\n'
done
MOCK_LOW_EXPECT="import { describe, it, expect, vi } from 'vitest';
${MOCK_LINES}
describe('mock-low-expect', () => {
  it('test', async () => {
    const m = await import('../foo.js');
    expect(m).toBeDefined();
    expect(m.foo).toBe(1);
  });
});"
run_case "mock-low-expect" 1 "$MOCK_LOW_EXPECT"

# Case E: 真行为断言（toBe / toEqual obj） → PASS
read -r -d '' GOOD <<'EOF' || true
import { describe, it, expect } from 'vitest';
import { foo } from '../foo.js';
describe('good', () => {
  it('foo equals 1', () => {
    const result = foo + 0;
    expect(result).toBe(1);
    expect(result).toEqual(1);
  });
});
EOF
run_case "good" 0 "$GOOD"

# Case F: 弱+强混合 → PASS（不全是弱）
read -r -d '' MIXED <<'EOF' || true
import { describe, it, expect } from 'vitest';
import { foo } from '../foo.js';
describe('mixed', () => {
  it('exists and equals', () => {
    expect(foo).toBeDefined();
    expect(foo).toBe(1);
  });
});
EOF
run_case "mixed" 0 "$MIXED"

# Case G: 0 expect → PASS（lint-test-quality 接管）
read -r -d '' EMPTY <<'EOF' || true
import { describe, it } from 'vitest';
describe('empty', () => {
  it('does nothing', () => {
    const x = 1;
  });
});
EOF
run_case "empty" 0 "$EMPTY"

echo ""
echo "lint-no-fake-test: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
