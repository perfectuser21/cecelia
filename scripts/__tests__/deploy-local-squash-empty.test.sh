#!/usr/bin/env bash
# deploy-local-squash-empty.test.sh
#
# 回归测试：squash merge 后 --changed 为空时 deploy-local.sh 不应跳过 Brain 部署
#
# 复现场景：
#   1. squash merge 后 CI 的 git diff "$BEFORE" "$AFTER" 因 fetch-depth 不足拿到空列表
#   2. ops.js 收到 changed_paths=[] → 不传 --changed 给 deploy-local.sh
#   3. deploy-local.sh fallback git diff "origin/main"...HEAD → pull 后为空 → SKIP
#
# 期望（修复后）：
#   deploy-local.sh 应 fallback 到 HEAD~1..HEAD，检测到 Brain 文件变更，触发部署

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0

ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }

echo "=== deploy-local-squash-empty: squash merge 后 changed 为空的 fallback 回归测试 ==="
echo ""

# ── 搭建最小化 git 场景（仿 squash merge 到 main 后的状态）────────────────────
TMP_REPO=$(mktemp -d)
TMP_BRAIN_DEPLOY=$(mktemp)

cleanup() {
    rm -rf "$TMP_REPO" "$TMP_BRAIN_DEPLOY" 2>/dev/null || true
}
trap cleanup EXIT

# 初始化 "远端" 裸仓库（模拟 origin）
git init --bare "$TMP_REPO/origin.git" -q
# 初始化 "本地" 仓库（模拟生产服务器的部署根）
git init "$TMP_REPO/repo" -q
cd "$TMP_REPO/repo"
git config user.email "test@test.com"
git config user.name "Test"
git remote add origin "$TMP_REPO/origin.git"

# 首次提交（main 初始状态）
mkdir -p packages/brain/src apps/dashboard
echo '{"version":"1.0.0"}' > packages/brain/package.json
echo "console.log('init');" > packages/brain/src/server.js
git add .
git commit -q -m "chore: init"
git push -q origin HEAD:main

# 本地跟踪 main
git checkout -q -b main
git branch -q --set-upstream-to origin/main main

# 拉最新（模拟生产机器已在 main）
git pull -q origin main

# 模拟 squash merge：在 main 上直接提交（就像 CI squash 一样）
echo "console.log('fixed brain');" >> packages/brain/src/server.js
git add .
git commit -q -m "fix(brain): some bug fix (squash)"

# 模拟 git pull 已完成（此时 origin/main 与 HEAD 一致）
git push -q origin main
git pull -q origin main

# 验证关键前提：pull 之后 origin/main...HEAD 确实为空（复现 bug）
DIFF_ORIGIN=$(git diff --name-only "origin/main"...HEAD 2>/dev/null || echo "")
if [[ -z "$DIFF_ORIGIN" ]]; then
    ok "前提确认：git diff 'origin/main'...HEAD 为空（squash 场景已复现）"
else
    fail "前提失败：git diff 结果不为空（测试场景设置有误）: $DIFF_ORIGIN"
fi

# ── 验证 HEAD~1..HEAD 能正确检测到 Brain 文件变更 ─────────────────────────────
DIFF_PREV=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || echo "")
if echo "$DIFF_PREV" | grep -q "packages/brain/"; then
    ok "HEAD~1..HEAD 能检测到 Brain 文件变更"
else
    fail "HEAD~1..HEAD 未检测到 Brain 文件变更 (got: '$DIFF_PREV')"
fi

# ── 运行 deploy-local.sh（--dry-run，不传 --changed，模拟 squash 空传）──────────
DEPLOY_SH="$REPO_ROOT/scripts/deploy-local.sh"

echo ""
echo "── 运行 deploy-local.sh --dry-run（不传 --changed，模拟 squash 空传）──"
CECELIA_DEPLOY_ROOT="$TMP_REPO/repo" \
    OUTPUT=$(bash "$DEPLOY_SH" --dry-run 2>&1 || true)
echo "$OUTPUT" | sed 's/^/  │ /'

# 期望：不应出现"跳过"，应检测到 Brain 改动
if echo "$OUTPUT" | grep -q "跳过：没有 Brain"; then
    fail "squash 后 --changed 为空时错误跳过了 Brain 部署（Bug 复现！修复未生效）"
else
    ok "未出现假跳过（修复已生效）"
fi

if echo "$OUTPUT" | grep -q "Brain 改动\|dry-run.*brain-deploy"; then
    ok "deploy-local.sh 正确检测到 Brain 文件需要部署"
else
    fail "deploy-local.sh 未检测到 Brain 文件改动（fallback 未生效）"
fi

# ── 验证 CI workflow 的 CHANGED 空判断兜底 ────────────────────────────────────
echo ""
echo "── 验证 brain-ci-deploy.yml 含空判断兜底 ──"
CI_YML="$REPO_ROOT/.github/workflows/brain-ci-deploy.yml"
# 修复后 CI yml 应含：检测到 CHANGED 为空时明确 fallback 到 packages/brain/
if grep -q 'CHANGED.*packages/brain\|fallback.*packages/brain\|-z.*CHANGED\|CHANGED.*-z' "$CI_YML" 2>/dev/null; then
    ok "brain-ci-deploy.yml 含 CHANGED 空值兜底逻辑"
else
    fail "brain-ci-deploy.yml 缺少 CHANGED 空值兜底（squash 后 ci 仍会假跳过）"
fi

echo ""
echo "── 验证 deploy-local.sh 含 HEAD~1..HEAD fallback ──"
# 修复后 deploy-local.sh 应含 HEAD~1..HEAD 或类似 fallback
if grep -q 'HEAD~1\|HEAD@{1}\|REFLOG_PREV' "$DEPLOY_SH" 2>/dev/null; then
    ok "deploy-local.sh 含 HEAD~1..HEAD fallback"
else
    fail "deploy-local.sh 缺少 HEAD~1..HEAD fallback（squash 后仍会假跳过）"
fi

echo ""
echo "=== 结果：PASS=$PASS  FAIL=$FAIL ==="
[[ $FAIL -eq 0 ]]
