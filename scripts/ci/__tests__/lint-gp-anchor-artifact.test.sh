#!/usr/bin/env bash
# 回归测试：lint-gp-anchor-artifact.sh —— GP 锚「产物闸」（决策 109dd8eb ①）
#
# 守护的病（2026-08-19 实证）：gp_anchor 是硬闸，但闸卡的是字段，20 个 PR 全以
# none(infra) 放行；publisher 释放候选工作区 × generator-fix 需候选工作区——两边单测
# 各自 mock 邻居全绿，边上的矛盾（workspace_source_attempt_unavailable）只能靠人撞。
# 修法：闸从「声明」挪到「产物」——PR 碰流水线路径，必须带 tests/gp/<journey>/step<N>-*
# 步骤断言文件，且该测试真 import 被改模块、不 vi.mock 它。
#
# 场景：
#   S1 未触碰流水线路径                         → 0（跳过）
#   S2 触碰流水线路径、无步骤断言文件            → 1（拦）
#   S3 有步骤断言文件，但它 vi.mock 了被改模块   → 1（拦：守卫没写在边上）
#   S4 有步骤断言文件，但它没 import 任何被改模块 → 1（拦：守卫和改动无关）
#   S5 有步骤断言文件，真 import 被改模块、无 mock → 0（过）
#   S6 只改了流水线路径下的 test 文件            → 0（跳过：测试不是产物闸对象）
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LINT="$REPO_ROOT/.github/workflows/scripts/lint-gp-anchor-artifact.sh"
FAIL=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# ── 搭一个最小 git 仓库：main 有基线，feature 分支上造改动 ──────────────────
R="$TMP/repo"; mkdir -p "$R"
git -C "$TMP" init -q -b main repo
git -C "$R" config core.hooksPath /dev/null
git -C "$R" config user.email t@t.t; git -C "$R" config user.name t
mkdir -p "$R/packages/brain/src/orchestrator" "$R/packages/brain/scripts/fleet-worker" "$R/tests/gp/f1" "$R/docs"
echo "export const a = 1;" > "$R/packages/brain/src/orchestrator/derive.js"
echo "module.exports = {};" > "$R/packages/brain/scripts/fleet-worker/attempt-runner.cjs"
echo "# doc" > "$R/docs/x.md"
( cd "$R" && git add -A && git commit -qm base )
BASE=$(git -C "$R" rev-parse HEAD)

reset_branch() {
  git -C "$R" checkout -q main 2>/dev/null
  git -C "$R" branch -D cp-01010101-feat >/dev/null 2>&1 || true
  git -C "$R" checkout -q -b cp-01010101-feat
  mkdir -p "$R/tests/gp/f1"
}
commit_all() { ( cd "$R" && git add -A && git commit -qm "$1" ); }

run_lint() {
  # 闸脚本以 BASE_REF 为参数，这里直接传 sha
  ( cd "$R" && bash "$LINT" "$BASE" ) >"$TMP/out" 2>&1
  echo $?
}

check() { # <name> <got> <want>
  if [ "$2" = "$3" ]; then echo "✅ $1"; else echo "❌ $1 (got exit=$2 want=$3)"; sed 's/^/    /' "$TMP/out" | head -12; FAIL=1; fi
}

# S1 未触碰流水线路径
reset_branch; echo "more" >> "$R/docs/x.md"; commit_all s1
check "S1 非流水线改动 → 跳过" "$(run_lint)" 0

# S2 触碰流水线路径、无步骤断言
reset_branch; echo "export const a = 2;" > "$R/packages/brain/src/orchestrator/derive.js"; commit_all s2
check "S2 流水线改动无步骤断言 → 拦" "$(run_lint)" 1
grep -q "tests/gp/" "$TMP/out" || { echo "❌ S2 报错未指引 tests/gp 路径"; FAIL=1; }

# S3 有步骤断言，但 vi.mock 了被改模块
reset_branch
echo "export const a = 3;" > "$R/packages/brain/src/orchestrator/derive.js"
cat > "$R/tests/gp/f1/step3-derive-edge.test.js" <<'EOF'
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../packages/brain/src/orchestrator/derive.js', () => ({ a: 99 }));
import { a } from '../../../packages/brain/src/orchestrator/derive.js';
describe('x', () => { it('y', () => { expect(a).toBe(99); }); });
EOF
commit_all s3
check "S3 步骤断言 mock 了被改模块 → 拦" "$(run_lint)" 1
grep -qi "mock" "$TMP/out" || { echo "❌ S3 报错未点名 mock"; FAIL=1; }

# S4 有步骤断言，但没 import 任何被改模块
reset_branch
echo "export const a = 4;" > "$R/packages/brain/src/orchestrator/derive.js"
cat > "$R/tests/gp/f1/step3-unrelated.test.js" <<'EOF'
import { describe, it, expect } from 'vitest';
describe('x', () => { it('y', () => { expect(1).toBe(1); }); });
EOF
commit_all s4
check "S4 步骤断言与改动无关 → 拦" "$(run_lint)" 1

# S5 真 import 被改模块、无 mock
reset_branch
echo "export const a = 5;" > "$R/packages/brain/src/orchestrator/derive.js"
cat > "$R/tests/gp/f1/step3-derive-edge.test.js" <<'EOF'
import { describe, it, expect } from 'vitest';
import { a } from '../../../packages/brain/src/orchestrator/derive.js';
describe('F1 step3', () => { it('derive real', () => { expect(a).toBe(5); }); });
EOF
commit_all s5
check "S5 步骤断言真 import 被改模块 → 过" "$(run_lint)" 0

# S6 只改流水线路径下的测试文件
reset_branch
mkdir -p "$R/packages/brain/src/orchestrator/__tests__"
echo "// t" > "$R/packages/brain/src/orchestrator/__tests__/derive.test.js"
commit_all s6
check "S6 只改流水线下的测试 → 跳过" "$(run_lint)" 0

# S7 impact-contract/ 属流水线路径（#4982 漏判实证：assertion-receipts.js 改动未触发闸）
reset_branch
mkdir -p "$R/packages/brain/src/impact-contract"
echo "export const g = 1;" > "$R/packages/brain/src/impact-contract/diff-gate.js"
commit_all s7
check "S7 impact-contract 改动无步骤断言 → 拦" "$(run_lint)" 1

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "SOME FAIL"; exit 1; }
