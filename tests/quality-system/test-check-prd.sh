#!/bin/bash
# 元测试：验证 check-prd.sh 的正确行为
# 场景1：无成功标准 → 应 exit 1
# 场景2：成功标准仅1条 → 应 exit 1
# 场景3：成功标准 ≥2 条 → 应 exit 0
# 场景4：PRD 文件不存在 → 应 exit 0（skip）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK_PRD="$REPO_ROOT/packages/engine/scripts/devgate/check-prd.sh"

if [[ ! -f "$CHECK_PRD" ]]; then
  echo "❌ check-prd.sh 不存在: $CHECK_PRD"
  exit 1
fi

# 创建临时目录，脚本在临时目录中运行（check-prd.sh 在 cwd 中查找 PRD 文件）
TMPDIR_PATH=$(mktemp -d)
trap "rm -rf $TMPDIR_PATH" EXIT

PASS_COUNT=0
FAIL_COUNT=0

# ─────────────────────────────────────────────
# 场景1：PRD 无成功标准章节 → 应 exit 1
# ─────────────────────────────────────────────
BRANCH1="meta-test-no-criteria"
cat > "$TMPDIR_PATH/.prd-${BRANCH1}.md" << 'EOF'
# PRD: 测试功能

## 背景
这是背景描述，说明为什么需要这个功能。

## 目标
实现某个功能。
EOF

if (cd "$TMPDIR_PATH" && GITHUB_HEAD_REF="$BRANCH1" bash "$CHECK_PRD" 2>/dev/null); then
  echo "❌ 场景1失败：期望 exit 1（无成功标准），实际 exit 0"
  echo "   check-prd.sh 没有正确拦截无成功标准的 PRD"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景1通过：无成功标准章节 → exit 1（门禁正常拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景2：PRD 有成功标准但只有 1 条 → 应 exit 1
# ─────────────────────────────────────────────
BRANCH2="meta-test-one-criteria"
cat > "$TMPDIR_PATH/.prd-${BRANCH2}.md" << 'EOF'
# PRD: 测试功能

## 成功标准
1. 只有一条成功标准
EOF

if (cd "$TMPDIR_PATH" && GITHUB_HEAD_REF="$BRANCH2" bash "$CHECK_PRD" 2>/dev/null); then
  echo "❌ 场景2失败：期望 exit 1（成功标准不足2条），实际 exit 0"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景2通过：成功标准仅1条 → exit 1（门禁正常拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景3：PRD 有成功标准 ≥2 条 → 应 exit 0
# ─────────────────────────────────────────────
BRANCH3="meta-test-valid-prd"
cat > "$TMPDIR_PATH/.prd-${BRANCH3}.md" << 'EOF'
# PRD: 测试功能

## 成功标准
1. 功能正常运行，测试全部通过
2. CI 门禁通过，代码质量达标
EOF

if ! (cd "$TMPDIR_PATH" && GITHUB_HEAD_REF="$BRANCH3" bash "$CHECK_PRD" 2>/dev/null); then
  echo "❌ 场景3失败：期望 exit 0（有效 PRD），实际 exit 1"
  echo "   check-prd.sh 误拦截了有效的 PRD"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景3通过：成功标准 ≥2 条 → exit 0（有效 PRD 正常通过）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景4：PRD 文件不存在 → 应 exit 1（A+ 方案：缺失 = 流程不完整 = FAIL）
# ─────────────────────────────────────────────
BRANCH4="meta-test-no-prd-file-$(date +%s)"
if (cd "$TMPDIR_PATH" && GITHUB_HEAD_REF="$BRANCH4" bash "$CHECK_PRD" 2>/dev/null); then
  echo "❌ 场景4失败：期望 exit 1（PRD 不存在应失败），实际 exit 0（存在 skipped 漏洞！）"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景4通过：PRD 文件不存在 → exit 1（A+ 强制证据，正确拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

echo ""
echo "check-prd.sh 场景验证: $PASS_COUNT 通过 / $FAIL_COUNT 失败"

[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
