#!/usr/bin/env bash
# lint-test-quality-cases.sh — 自跑验证 lint-test-quality.sh 规则正确
#
# 4 case：
#   A. stub（读 src grep + 无 await）→ expect FAIL
#   B. 空 expect → expect FAIL
#   C. 全 .skip → expect FAIL
#   D. 真行为 test → expect PASS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-test-quality.sh"

if [ ! -x "$LINT" ]; then
  echo "FATAL: lint not found / not executable: $LINT"
  exit 1
fi

PASSED=0
FAILED=0

run_case() {
  local name="$1" expect_fail="$2" content="$3"

  # 每个 case 一个独立 fake-git 仓库
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

  # 在新分支加 test 文件
  git checkout -q -b "case-$name"
  echo "$content" > "src/__tests__/${name}.test.js"
  git add "src/__tests__/${name}.test.js"
  git commit -q -m "$name"

  bash "$LINT" main >/tmp/lint-out.txt 2>&1
  local rc=$?

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] 正确拒（exit $rc）"
    PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] 正确放（exit 0）"
    PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got rc=$rc"
    cat /tmp/lint-out.txt
    FAILED=$((FAILED+1))
  fi

  cd /tmp
  rm -rf "$TMPDIR"
}

# Case A: stub —— readFileSync(src) + 全部 .toContain
read -r -d '' STUB_CONTENT <<'EOF' || true
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const src = fs.readFileSync(path.resolve(__dirname, '../foo.js'), 'utf8');
describe('foo stub', () => {
  it('contains literal', () => {
    expect(src).toContain('foo');
    expect(src).toContain('export');
  });
});
EOF
run_case "stub" 1 "$STUB_CONTENT"

# Case B: 空 expect
read -r -d '' EMPTY_CONTENT <<'EOF' || true
import { describe, it } from 'vitest';
describe('empty', () => {
  it('does nothing', () => {
    const x = 1;
  });
});
EOF
run_case "empty" 1 "$EMPTY_CONTENT"

# Case C: 全 .skip
read -r -d '' SKIPPED_CONTENT <<'EOF' || true
import { describe, it, expect } from 'vitest';
describe('all-skip', () => {
  it.skip('a', () => { expect(1).toBe(1); });
  it.skip('b', () => { expect(2).toBe(2); });
});
EOF
run_case "all-skip" 1 "$SKIPPED_CONTENT"

# Case D: 真行为 test —— await + 函数调用
read -r -d '' GOOD_CONTENT <<'EOF' || true
import { describe, it, expect } from 'vitest';
import { foo } from '../foo.js';
describe('foo behavior', () => {
  it('foo equals 1', async () => {
    const result = await Promise.resolve(foo);
    expect(result).toBe(1);
  });
});
EOF
run_case "good" 0 "$GOOD_CONTENT"

echo ""
echo "lint-test-quality-cases: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
