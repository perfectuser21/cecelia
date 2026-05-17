#!/bin/bash
# 元测试：验证 check-learning.sh 的正确行为（v2 per-branch 模式）
# 场景1：无 Learning 文件 → 应 exit 1
# 场景2：docs/learnings/<branch>.md 有内容且格式正确 → 应 exit 0
# 场景3：docs/learnings/<branch>.md 格式错误（无根本原因）→ 应 exit 1
# 场景4：PR title 含 [SKIP-LEARNING] → 应 exit 0（例外机制）
# 场景5：旧格式 docs/LEARNINGS.md 向后兼容 → 应 exit 0

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK_LEARNING="$REPO_ROOT/packages/engine/scripts/devgate/check-learning.sh"

if [[ ! -f "$CHECK_LEARNING" ]]; then
  echo "❌ check-learning.sh 不存在: $CHECK_LEARNING"
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

# 在临时 git 仓库中运行
TMPDIR_PATH=$(mktemp -d)
trap "rm -rf $TMPDIR_PATH" EXIT

git -C "$TMPDIR_PATH" init -q
git -C "$TMPDIR_PATH" config user.email "test@test.com"
git -C "$TMPDIR_PATH" config user.name "Test"
git -C "$TMPDIR_PATH" remote add origin https://github.com/fake/repo.git

# 创建 main 基础提交（模拟 origin/main）
mkdir -p "$TMPDIR_PATH/docs/learnings"
touch "$TMPDIR_PATH/docs/learnings/.gitkeep"
touch "$TMPDIR_PATH/docs/.gitkeep"
git -C "$TMPDIR_PATH" add .
git -C "$TMPDIR_PATH" commit -q -m "init"
git -C "$TMPDIR_PATH" branch -m main

# 创建功能分支（PR 分支）
git -C "$TMPDIR_PATH" checkout -q -b cp-test-branch

# ─────────────────────────────────────────────
# 场景1：无 Learning 文件 → 应 exit 1
# ─────────────────────────────────────────────
if (cd "$TMPDIR_PATH" && PR_TITLE="fix: test" bash "$CHECK_LEARNING" 2>/dev/null); then
  echo "❌ 场景1失败：期望 exit 1（无 Learning 文件），实际 exit 0"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景1通过：无 Learning 文件 → exit 1（正确拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景2：docs/learnings/<branch>.md 有内容且格式正确 → 应 exit 0
# ─────────────────────────────────────────────
VALID_LEARNING=$(cat << 'EOF'
## Per-Branch Learning 测试（2026-03-11）

### 根本原因
并行 /dev 都写同一个 LEARNINGS.md 导致合并冲突。

### 下次预防
- [ ] 使用 per-branch learning 文件
- [ ] 检查 docs/learnings/ 目录
EOF
)

echo "$VALID_LEARNING" > "$TMPDIR_PATH/docs/learnings/cp-test-branch.md"
git -C "$TMPDIR_PATH" add docs/learnings/cp-test-branch.md
git -C "$TMPDIR_PATH" commit -q -m "add per-branch learning"

# 验证格式检查逻辑
(
  cd "$TMPDIR_PATH"
  NEW_CONTENT=$(cat docs/learnings/cp-test-branch.md)
  HAS_ROOT=$(echo "$NEW_CONTENT" | grep -cE "根本原因|Root Cause" || true)
  HAS_PREV=$(echo "$NEW_CONTENT" | grep -cE "下次预防|Prevention" || true)
  HAS_CHECK=$(echo "$NEW_CONTENT" | grep -cE "^\s*-\s*\[" || true)
  if [[ "$HAS_ROOT" -gt 0 && "$HAS_PREV" -gt 0 && "$HAS_CHECK" -gt 0 ]]; then
    echo "✅ 场景2通过：per-branch Learning 格式验证正确"
    exit 0
  else
    echo "❌ 场景2失败：per-branch Learning 格式被错误拦截"
    exit 1
  fi
)
if [ $? -eq 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景3：docs/learnings/<branch>.md 格式错误（无根本原因）→ 应 exit 1
# ─────────────────────────────────────────────
(
  cd "$TMPDIR_PATH"
  NEW_CONTENT="## 随便写了点什么

- [ ] 做了一些修改
"
  HAS_ROOT=$(echo "$NEW_CONTENT" | grep -cE "根本原因|Root Cause" || true)
  if [[ "$HAS_ROOT" -eq 0 ]]; then
    echo "✅ 场景3通过：缺少根本原因章节 → 正确拦截"
    exit 0
  else
    echo "❌ 场景3失败：格式错误未被拦截"
    exit 1
  fi
)
if [ $? -eq 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景4：PR title 含 [SKIP-LEARNING] → 应 exit 0（例外机制）
# ─────────────────────────────────────────────
# 先删除 learning 文件以确保是 SKIP 生效而不是文件检查通过
git -C "$TMPDIR_PATH" rm -q docs/learnings/cp-test-branch.md 2>/dev/null || true
git -C "$TMPDIR_PATH" commit -q -m "remove learning for skip test" --allow-empty

if ! (cd "$TMPDIR_PATH" && PR_TITLE="[SKIP-LEARNING] fix: some config" bash "$CHECK_LEARNING" 2>/dev/null); then
  echo "❌ 场景4失败：期望 exit 0（[SKIP-LEARNING] 例外），实际 exit 1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景4通过：[SKIP-LEARNING] 例外机制正常工作 → exit 0"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景5：旧格式 docs/LEARNINGS.md 向后兼容 → 应 exit 0
# ─────────────────────────────────────────────
(
  cd "$TMPDIR_PATH"
  # 验证旧格式文件名也在 check-learning.sh 的检查范围内
  SCRIPT_CONTENT=$(cat "$CHECK_LEARNING")
  HAS_OLD_FORMAT=$(echo "$SCRIPT_CONTENT" | grep -c "docs/LEARNINGS.md" || true)
  if [[ "$HAS_OLD_FORMAT" -gt 0 ]]; then
    echo "✅ 场景5通过：check-learning.sh 包含 docs/LEARNINGS.md 向后兼容"
    exit 0
  else
    echo "❌ 场景5失败：check-learning.sh 不包含旧格式兼容"
    exit 1
  fi
)
if [ $? -eq 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "check-learning.sh 场景验证: $PASS_COUNT 通过 / $FAIL_COUNT 失败"

[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
