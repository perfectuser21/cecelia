#!/usr/bin/env bash
# pr-size-count.test.sh — 自跑验证 pr-size-count.sh（pr-size-check 的行数统计）
#
# 金丝雀 4 #6232：coding workflow 多轮 QA/裁判记录（sprints/）撑到新增 3129 行被硬门槛拦下，
# 代码本身不到 500 行。GAN 轮次无上限（invariant 02d8e749），记录必然增长，统计不得计入 sprints/。
#
# 4 case：
#   A. 只改代码                 → 计入
#   B. 代码 + 大量 sprints 记录 → 只计代码
#   C. 只有 sprints 记录        → 0 0
#   D. 删除行同样排除 sprints/  → 只计代码删除
#
# 注意：故意不用 set -e，要让所有 case 跑完再统计。

set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/pr-size-count.sh"
if [ ! -f "$SCRIPT" ]; then
  echo "FATAL: script not found: $SCRIPT"
  exit 1
fi

PASSED=0
FAILED=0

lines() { mkdir -p "$(dirname "$2")"; seq 1 "$1" > "$2"; }

# 禁用本机全局 hooks（开发机 core.hooksPath 会拦 main 上的提交）
snapshot() { git add -A && git -c core.hooksPath=/dev/null commit -qm "$1"; }

# 每个 case：在临时仓库建 base 提交，回调里做 head 改动，断言输出 "<新增> <删除>"
run_case() {
  local name="$1" expect="$2" setup="$3"
  local TMP got
  TMP=$(mktemp -d)
  (
    cd "$TMP" || exit 1
    git init -q && git config user.email t@t && git config user.name t
    lines 100 src/keep.js
    lines 200 sprints/old/05-qa-report-r1.md
    snapshot base
    $setup
    snapshot head
  ) >/dev/null 2>&1
  got=$(cd "$TMP" && bash "$SCRIPT" HEAD~1 HEAD 2>&1)
  if [ "$got" = "$expect" ]; then
    echo "  ✅ ${name}（${got}）"; PASSED=$((PASSED + 1))
  else
    echo "  ❌ ${name}：期望「${expect}」，实际「${got}」"; FAILED=$((FAILED + 1))
  fi
  rm -rf "$TMP"
}

case_a() { lines 10 src/new.js; }
case_b() { lines 10 src/new.js; lines 5000 sprints/10101755-cw-x/05-qa-report-r9.md; }
case_c() { lines 4000 sprints/10101755-cw-x/06-judge-r9.md; }
case_d() { rm src/keep.js sprints/old/05-qa-report-r1.md; }

echo "pr-size-count.sh 自测："
run_case "A 只改代码" "10 0" case_a
run_case "B 代码 + sprints 记录只计代码" "10 0" case_b
run_case "C 只有 sprints 记录" "0 0" case_c
run_case "D 删除行排除 sprints/" "0 100" case_d

echo "结果：通过 ${PASSED}，失败 ${FAILED}"
[ "$FAILED" -eq 0 ]
