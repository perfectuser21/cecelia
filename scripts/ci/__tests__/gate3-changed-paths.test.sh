#!/usr/bin/env bash
# gate3-changed-paths.test.sh — Gate3 变更检测回归测试
# 根治 2026-07-15 假跳过 P1：原 workflow 内联管道的 || echo fallback 是死代码
# （管道退出码取 tr 恒 0），shallow diff 失败/无命中时静默送出空列表。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$SCRIPT_DIR/../gate3-changed-paths.sh"
FAILED=0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q
git config user.email t@t && git config user.name t
# 屏蔽全局 core.hooksPath（本机指向 ~/.git-hooks，会拦截临时 repo 的 commit）
git config core.hooksPath /dev/null
mkdir -p packages/brain/src
echo a > packages/brain/src/foo.js && echo r > README.md
git add -A && git commit -qm c1
C1=$(git rev-parse HEAD)
echo b > packages/brain/src/foo.js
git add -A && git commit -qm c2
C2=$(git rev-parse HEAD)
echo r2 > README.md
git add -A && git commit -qm c3
C3=$(git rev-parse HEAD)

assert_eq() { # $1=case $2=expected $3=actual
  if [[ "$3" == "$2" ]]; then echo "  ✅ $1"; else echo "  ❌ $1: 期望 [$2] 实得 [$3]"; FAILED=1; fi
}

# case1 正常命中：C1..C2 改了 packages/brain/src/foo.js
OUT=$(bash "$SUT" "$C1" "$C2")
assert_eq "正常命中" "packages/brain/src/foo.js " "$OUT"

# case2 grep 无命中（C2..C3 只改 README）→ fallback packages/brain/
OUT=$(bash "$SUT" "$C2" "$C3")
assert_eq "无 brain 命中 fallback" "packages/brain/" "$OUT"

# case3 diff 失败（伪 SHA）→ fallback packages/brain/
OUT=$(bash "$SUT" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$C2")
assert_eq "diff 失败 fallback" "packages/brain/" "$OUT"

# case4 首次 push（BEFORE 全零）→ packages/brain/
OUT=$(bash "$SUT" "0000000000000000000000000000000000000000" "$C2")
assert_eq "首次 push" "packages/brain/" "$OUT"

[[ "$FAILED" == 0 ]] && echo "gate3-changed-paths.test.sh: OK" || { echo "gate3-changed-paths.test.sh: FAILED"; exit 1; }
