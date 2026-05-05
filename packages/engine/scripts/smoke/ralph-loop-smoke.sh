#!/usr/bin/env bash
# ralph-loop-smoke.sh — Stop Hook Ralph Loop 模式端到端 smoke 测试

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"

PASS=0
FAIL=0
TMPROOT=$(mktemp -d -t ralph-smoke-XXXXXX)
trap 'rm -rf "$TMPROOT"' EXIT

assert_eq() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then echo "✅ $label"; PASS=$((PASS+1))
    else echo "❌ $label: 期望 [$expected] 实际 [$got]"; FAIL=$((FAIL+1)); fi
}

assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then echo "✅ $label"; PASS=$((PASS+1))
    else echo "❌ $label: 缺 [$needle]"; FAIL=$((FAIL+1)); fi
}

assert_file_exists() {
    local label="$1" file="$2"
    if [[ -f "$file" ]]; then echo "✅ $label"; PASS=$((PASS+1))
    else echo "❌ $label: 缺 $file"; FAIL=$((FAIL+1)); fi
}

assert_file_absent() {
    local label="$1" file="$2"
    if [[ ! -f "$file" ]]; then echo "✅ $label"; PASS=$((PASS+1))
    else echo "❌ $label: 应已删 $file"; FAIL=$((FAIL+1)); fi
}

# Step 1: 起真 git repo + worktree + 创状态文件
echo "=== Step 1: 真起 git repo + worktree ==="
MAIN_REPO="$TMPROOT/main"
WORKTREE="$TMPROOT/wt"
BRANCH="cp-smoke-test"
mkdir -p "$MAIN_REPO"
cd "$MAIN_REPO"
git init -q -b main
git config user.email t@e.com
git config user.name t
echo "#" > README.md
git add . && git commit -q -m init
git worktree add "$WORKTREE" -b "$BRANCH" 2>/dev/null
mkdir -p "$MAIN_REPO/.cecelia"
cat > "$MAIN_REPO/.cecelia/dev-active-${BRANCH}.json" <<EOF
{"branch":"$BRANCH","worktree":"$WORKTREE","started_at":"2026-05-04T20:00:00+08:00","session_id":"smoke"}
EOF
assert_file_exists "Step 1 .cecelia/dev-active 创建" "$MAIN_REPO/.cecelia/dev-active-${BRANCH}.json"

# Step 2: cwd=worktree → block
echo ""
echo "=== Step 2: cwd=worktree → block ==="
GH_STUB="$TMPROOT/gh-stub"
mkdir -p "$GH_STUB"
echo '#!/usr/bin/env bash
echo ""
exit 0' > "$GH_STUB/gh"
chmod +x "$GH_STUB/gh"
OUT_2=$(CLAUDE_HOOK_CWD="$WORKTREE" PATH="$GH_STUB:$PATH" bash "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" 2>&1)
EXIT_2=$?
assert_eq "Step 2 exit=0" "0" "$EXIT_2"
assert_contains "Step 2 含 decision" '"decision"' "$OUT_2"
assert_contains "Step 2 含 PR 未创建" "PR 未创建" "$OUT_2"
assert_file_exists "Step 2 状态文件未删" "$MAIN_REPO/.cecelia/dev-active-${BRANCH}.json"

# Step 3: cwd=主仓库 → 仍 block
echo ""
echo "=== Step 3: cwd=主仓库 → 仍 block（cwd 漂移修复）==="
OUT_3=$(CLAUDE_HOOK_CWD="$MAIN_REPO" PATH="$GH_STUB:$PATH" bash "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" 2>&1)
EXIT_3=$?
assert_eq "Step 3 exit=0" "0" "$EXIT_3"
assert_contains "Step 3 含 decision" '"decision"' "$OUT_3"
assert_file_exists "Step 3 状态文件未删" "$MAIN_REPO/.cecelia/dev-active-${BRANCH}.json"

# Step 4: 三全满足 → done + rm
echo ""
echo "=== Step 4: mock 三全满足 → done + rm ==="
cat > "$GH_STUB/gh" <<'GHEOF'
#!/usr/bin/env bash
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T20:00:00Z" ;;
esac
exit 0
GHEOF
chmod +x "$GH_STUB/gh"

mkdir -p "$MAIN_REPO/docs/learnings"
cat > "$MAIN_REPO/docs/learnings/${BRANCH}.md" <<EOF
# Learning
### 根本原因
smoke test
### 下次预防
- [ ] x
EOF

mkdir -p "$MAIN_REPO/packages/engine/skills/dev/scripts"
echo '#!/usr/bin/env bash
exit 0' > "$MAIN_REPO/packages/engine/skills/dev/scripts/cleanup.sh"
chmod +x "$MAIN_REPO/packages/engine/skills/dev/scripts/cleanup.sh"

# v18.21.0: smoke 测"老三阶段" (PR/Learning/cleanup)，不测 P5/P6
# escape hatch disable P5/P6（stop-hook-7stage-smoke.sh 单独覆盖 P5/P6）
OUT_4=$(VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 \
        CLAUDE_HOOK_CWD="$WORKTREE" PATH="$GH_STUB:$PATH" \
        bash "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" 2>&1)
EXIT_4=$?
assert_eq "Step 4 exit=0" "0" "$EXIT_4"
# done 路径：stdout 静默不输出 decision JSON（Claude Code 协议合法值只有 approve/block）
if [[ "$OUT_4" != *'"decision"'* ]]; then
    echo "✅ Step 4 stdout 不含 decision（按 Ralph 官方静默退出）"
    PASS=$((PASS+1))
else
    echo "❌ Step 4 stdout 不该含 decision JSON"
    FAIL=$((FAIL+1))
fi
assert_contains "Step 4 含真完成（stderr 诊断）" "真完成" "$OUT_4"
assert_file_absent "Step 4 [关键] 状态文件被 rm" "$MAIN_REPO/.cecelia/dev-active-${BRANCH}.json"

echo ""
echo "=== Ralph Loop Smoke: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
