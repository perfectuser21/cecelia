#!/usr/bin/env bash
# 回归测试：list-fs-guard-tests.sh 选择逻辑 + vitest --changed 漏跑演示
#
# 守护 bug：vitest --changed 漏跑 fs 读取型守卫测试（#3506 / 2026-07-02 两次应验）。
#
# Tier A（确定性，无外部依赖，CI 强制）：
#   证明 selector 精确识别 "运行时 fs 读文件" 测试：命中 readFileSync 型 -> 选中；
#   纯 import 型 -> 不选；integration 目录 -> 排除。
#
# Tier B（真 vitest 演示，vitest 不可用则 SKIP）：
#   构造 "改 A 文件、B 测试用 readFileSync 读 A 断言" 场景，实证：
#   修复前 `vitest --changed` 漏选 B（漏跑）；union 附加 selector 输出后 B 必跑。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SELECTOR="$REPO_ROOT/.github/workflows/scripts/list-fs-guard-tests.sh"
FAIL=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

echo "== Tier A: selector 选择逻辑 =="
[ -x "$SELECTOR" ] || chmod +x "$SELECTOR" 2>/dev/null || true

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
mkdir -p "$FIX/tests/integration"
# guard：运行时 readFileSync -> 必须被选中
cat > "$FIX/tests/guard-a.test.js" <<'EOF'
import { readFileSync } from 'fs';
const s = readFileSync('x', 'utf8');
EOF
# 另一种写法：fs.readFile( -> 也必须被选中
cat > "$FIX/tests/guard-b.test.js" <<'EOF'
import fs from 'fs';
fs.readFile('x', () => {});
EOF
# 纯 import，无 fs 读 -> 不选
cat > "$FIX/tests/normal.test.js" <<'EOF'
import { thing } from '../src/thing.js';
EOF
# integration 目录内即使有 readFileSync -> 排除（与 brain-unit --exclude 对齐）
cat > "$FIX/tests/integration/deep.test.js" <<'EOF'
import { readFileSync } from 'fs';
readFileSync('y');
EOF

OUT=$("$SELECTOR" "$FIX/tests" 2>/dev/null || true)
echo "$OUT" | grep -q 'guard-a.test.js' && pass "readFileSync 型被选中 (guard-a)" || fail "guard-a 应被选中"
echo "$OUT" | grep -q 'guard-b.test.js' && pass "fs.readFile( 型被选中 (guard-b)" || fail "guard-b 应被选中"
echo "$OUT" | grep -q 'normal.test.js' && fail "normal 不应被选中" || pass "纯 import 型不选 (normal)"
echo "$OUT" | grep -q 'integration/deep' && fail "integration 应被排除" || pass "integration 目录排除"

# 对真实 brain 测试运行：必须非空，且每个输出文件确实含标记
REAL_DIR="$REPO_ROOT/packages/brain/src/__tests__"
if [ -d "$REAL_DIR" ]; then
  REAL=$("$SELECTOR" "$REAL_DIR" 2>/dev/null || true)
  CNT=$(echo "$REAL" | grep -c . || true)
  [ "$CNT" -gt 0 ] && pass "真实 brain 守卫组非空 ($CNT 个)" || fail "真实 brain 守卫组不应为空"
fi

echo ""
echo "== Tier B: vitest --changed 漏跑 -> 必跑 实证 =="
# 解析 vitest 二进制（VITEST_BIN 覆盖 -> brain 本地 -> workspace 根 hoist）
VITEST="${VITEST_BIN:-}"
if [ -z "$VITEST" ]; then
  for cand in \
    "$REPO_ROOT/packages/brain/node_modules/.bin/vitest" \
    "$REPO_ROOT/node_modules/.bin/vitest"; do
    if [ -x "$cand" ]; then VITEST="$cand"; break; fi
  done
fi
if [ -z "$VITEST" ]; then
  echo "  ⏭️  SKIP：未找到 vitest 二进制（非 brain 依赖环境），Tier A 已守护 selector 逻辑"
else
  # vitest 需要 node_modules 解析 vitest/config 与 'vitest' 导入 —— 软链进 fixture
  NM=$(cd "$(dirname "$VITEST")/.." && pwd)
  W=$(mktemp -d)
  ln -s "$NM" "$W/node_modules"
  (
    cd "$W" || exit 1
    git init -q
    git config core.hooksPath /dev/null   # 隔离全局 pre-commit 钩子（临时 fixture 仓自洽）
    git config user.email t@t.co && git config user.name t
    printf "export const MARKER = 'V1';\n" > dataA.js
    # B：readFileSync 运行时读 dataA（不 import）-> --changed 漏选
    printf "import { readFileSync } from 'fs';\nimport { resolve } from 'path';\nimport { test, expect } from 'vitest';\ntest('B reads dataA at runtime', () => {\n  expect(readFileSync(resolve(__dirname,'dataA.js'),'utf8')).toContain('MARKER');\n});\n" > b.guard.test.js
    # C：import dataA -> --changed 正常选中
    printf "import { test, expect } from 'vitest';\nimport { MARKER } from './dataA.js';\ntest('C imports dataA', () => { expect(MARKER).toBe('V1'); });\n" > c.normal.test.js
    git add -A && git commit -qm base --no-verify >/dev/null
    printf "export const MARKER = 'V1'; // touched\n" > dataA.js
    git add -A && git commit -qm touch --no-verify >/dev/null
  )
  # ── 修复前：CI 快路只有一次 `vitest --changed`（只改 dataA.js）──
  BEFORE=$(cd "$W" && "$VITEST" run --changed HEAD~1 --reporter=verbose 2>&1 || true)
  echo "$BEFORE" | grep -q 'c.normal.test.js' && pass "修复前 --changed 选中 import 型 C（基线正常）" || fail "C 应被 --changed 选中"
  if echo "$BEFORE" | grep -q 'b.guard.test.js'; then
    fail "修复前 --changed 竟选中了 fs 读取型 B —— 无法复现漏跑，测试假设失效"
  else
    pass "修复前 --changed 漏选 fs 读取型 B（漏跑复现 ✓）"
  fi
  # ── 修复后：CI 追加第二次调用，跑 selector 输出的守卫组（无 --changed）──
  # 注：实证已确认 `--changed <files>` 是【交集】不是并集，故守卫组必须独立第二次调用。
  GUARDS=$("$SELECTOR" "$W" 2>/dev/null || true)
  AFTER=$(cd "$W" && "$VITEST" run $GUARDS --reporter=verbose 2>&1 || true)
  echo "$AFTER" | grep -q 'b.guard.test.js' && pass "第二次调用跑守卫组后 fs 读取型 B 必跑（漏跑修复 ✓）" || fail "修复后 B 仍未跑"
  echo "$GUARDS" | grep -q 'c.normal' && fail "守卫组不应含纯 import 型 C" || pass "守卫组精确只含 fs 读取型（不含 C）"
  rm -rf "$W"
fi

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "❌ list-fs-guard-tests 回归测试失败"
  exit 1
fi
echo "✅ list-fs-guard-tests 回归测试全部通过"
