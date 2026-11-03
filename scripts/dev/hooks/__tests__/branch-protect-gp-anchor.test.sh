#!/usr/bin/env bash
# GP锚定闭环 刀6 — branch-protect.sh gp_anchor 硬校验测试（自动化，非手工）
# 用法：bash hooks/tests/branch-protect-gp-anchor.test.sh
#
# 覆盖 5 个场景（对应 PrepPRD 验收标准）：
#   S1  .dev-mode 无 gp_anchor 行           → exit 2（拦）
#   S2  gp_anchor: none(docs)               → exit 0（放）
#   S3  合法推进锚 + product-map 含该 id     → exit 0（放）
#   S4  格式合法但 id 查无                   → exit 2（拦）
#   S5  fail-open：合法格式但两处 map 均缺失  → exit 0（放 + 警告）
set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/branch-protect.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 搭一个满足 hook 前置条件的最小 worktree 场景 ─────────────────────────
# hook 要求：cp-* 分支 + worktree + .dev-mode.<branch> 存在，才走到 gp_anchor 检查
MAIN="$TMP/main-repo"
mkdir -p "$MAIN"
git -C "$TMP" init -q -b main main-repo
git -C "$MAIN" config core.hooksPath /dev/null
git -C "$MAIN" config user.email t@t.t
git -C "$MAIN" config user.name t
( cd "$MAIN" && echo x > f.txt && git add f.txt && git commit -qm init )

BRANCH="cp-01010101-gp-anchor-test"
WT="$TMP/wt"
git -C "$MAIN" worktree add -q "$WT" -b "$BRANCH"
# 制造 1 个 ahead commit（绕开僵尸 worktree 检测的 COMMITS_AHEAD=0 分支）
( cd "$WT" && echo y > g.txt && git add g.txt && git commit -qm ahead )

DEV_MODE="$WT/.dev-mode.$BRANCH"
TARGET_FILE="$WT/src.sh"   # .sh 落在 NEEDS_PROTECTION 扩展名集合内
mkdir -p "$WT"

hook_input() {
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$TARGET_FILE"
}

run_hook() {
  # GP_ANCHOR_CENTRAL_MAP 由各场景显式控制（fail-open 场景指向不存在路径）
  hook_input | GP_ANCHOR_CENTRAL_MAP="${CENTRAL_MAP:-$TMP/no-such-central.json}" bash "$HOOK" 2>"$TMP/stderr.txt"
}

PASS=0; FAIL=0
assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望 exit=$expected 实际 exit=$actual)"
    sed 's/^/  stderr: /' "$TMP/stderr.txt" | head -5
    FAIL=$((FAIL+1))
  fi
}

# ── S1: 无 gp_anchor 行 → 拦 ────────────────────────────────────────────
cat > "$DEV_MODE" << 'EOF'
task_id: 00000000-0000-0000-0000-000000000000
EOF
run_hook; assert_exit "S1 无gp_anchor行被拦" 2 $?

# ── S2: none(docs) → 放 ────────────────────────────────────────────────
cat > "$DEV_MODE" << 'EOF'
task_id: 00000000-0000-0000-0000-000000000000
gp_anchor: none(docs)
EOF
run_hook; assert_exit "S2 none(docs)豁免放行" 0 $?

# ── S3: 合法推进锚 + 本仓库 product-map 含 id → 放 ──────────────────────
mkdir -p "$WT/product-map/generated"
cat > "$WT/product-map/generated/product-map.json" << 'EOF'
{"golden_paths":[{"id":"gp_real","line_id":"line00"}]}
EOF
cat > "$DEV_MODE" << 'EOF'
gp_anchor: line00/gp_real#step1
EOF
run_hook; assert_exit "S3 合法锚+id存在放行" 0 $?

# ── S4: 格式合法但 id 查无 → 拦 ─────────────────────────────────────────
cat > "$DEV_MODE" << 'EOF'
gp_anchor: line99/no_such_gp keep-green
EOF
run_hook; assert_exit "S4 id查无被拦" 2 $?

# ── S5: fail-open——两处 map 均缺失 → 放（带警告） ────────────────────────
rm -rf "$WT/product-map"
cat > "$DEV_MODE" << 'EOF'
gp_anchor: line00/gp_real#step1
EOF
run_hook; assert_exit "S5 map全缺fail-open放行" 0 $?

echo ""
echo "结果: $PASS pass / $FAIL fail"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
