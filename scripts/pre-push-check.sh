#!/usr/bin/env bash
# pre-push-check.sh — 推送前本地预检，拦截常见 CI 失败
#
# 用法：bash scripts/pre-push-check.sh
# 退出码：0 = 通过，1 = 失败
#
# 检查项：
#   1. Brain 版本号已更新（仅在 packages/brain/** 有改动时）
#   2. Migration 编号不与 origin/main 冲突
#   3. DoD 文件格式（如存在）
#   4. Facts 一致性（仅在 Brain 有改动时）

set -e

PASS=true
BASE_REF="origin/main"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Pre-Push 本地预检"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 确保有 origin/main 的最新信息
git fetch origin main --quiet 2>/dev/null || true

CHANGED_FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || echo "")

# ─────────────────────────────────────────
# 检查 1：Brain 版本号更新
# ─────────────────────────────────────────
echo "[1/4] 版本号检查（Brain）"

BRAIN_CHANGED=false
if echo "$CHANGED_FILES" | grep -qE "^packages/brain/|^DEFINITION\.md$|^\.brain-versions$"; then
  BRAIN_CHANGED=true
fi

if [ "$BRAIN_CHANGED" = "true" ]; then
  BASE_VER=$(git show "${BASE_REF}:packages/brain/package.json" 2>/dev/null | jq -r '.version' || echo "")
  CURR_VER=$(jq -r '.version' packages/brain/package.json 2>/dev/null || echo "")

  if [ -n "$BASE_VER" ] && [ "$BASE_VER" = "$CURR_VER" ]; then
    echo "  ❌ packages/brain/package.json 版本未更新（当前: $CURR_VER，与 main 相同）"
    echo "     修复: npm version patch --no-git-tag-version --workspace packages/brain"
    PASS=false
  else
    echo "  ✅ Brain 版本: $BASE_VER → $CURR_VER"
  fi
else
  echo "  ⏭  无 Brain 改动，跳过"
fi
echo ""

# ─────────────────────────────────────────
# 检查 2：Migration 编号冲突
# ─────────────────────────────────────────
echo "[2/4] Migration 编号冲突检查"

NEW_MIGRATIONS=$(echo "$CHANGED_FILES" | grep -E "^packages/brain/migrations/[0-9]" || true)

if [ -n "$NEW_MIGRATIONS" ]; then
  # 获取 main 上的最高 migration 编号
  MAIN_MAX=$(git show "${BASE_REF}:packages/brain/migrations/" 2>/dev/null \
    | grep -oE '^[0-9]+' | sort -n | tail -1 || echo "0")
  # 获取本分支新增的 migration 编号
  LOCAL_NUMS=$(echo "$NEW_MIGRATIONS" | grep -oE '/([0-9]+)_' | tr -d '/' | tr -d '_')

  CONFLICT=false
  while IFS= read -r num; do
    [ -z "$num" ] && continue
    if [ "$num" -le "$MAIN_MAX" ]; then
      echo "  ❌ Migration $num 与 main 冲突（main 最高: $MAIN_MAX）"
      CONFLICT=true
    fi
  done <<< "$LOCAL_NUMS"

  if [ "$CONFLICT" = "true" ]; then
    echo "     修复: 将 migration 文件重命名为 $((MAIN_MAX + 1))_xxx.sql"
    PASS=false
  else
    echo "  ✅ Migration 编号无冲突（main 最高: $MAIN_MAX）"
  fi
else
  echo "  ⏭  无新 migration，跳过"
fi
echo ""

# ─────────────────────────────────────────
# 检查 3：DoD 文件格式
# ─────────────────────────────────────────
echo "[3/4] DoD 文件格式检查"

DOD_FILES=$(find . -maxdepth 2 -name ".dod-*.md" 2>/dev/null | grep -v ".claude/worktrees" || true)

if [ -n "$DOD_FILES" ]; then
  DOD_OK=true

  while IFS= read -r dod; do
    [ -z "$dod" ] && continue

    # 检查：Test 行不能有 "- Test:"（带 dash），正确格式是 "  Test:"
    if grep -qE "^\s+-\s+Test:" "$dod"; then
      echo "  ❌ $dod: 发现 '- Test:' 格式，应为 '  Test:'"
      DOD_OK=false
    fi

    # 检查：DoD 中不能有未完成的 [ ] （允许最终 PR 时为空，但 push 前必须全勾）
    UNCHECKED=$(grep -cE "^\s*-\s+\[\s+\]" "$dod" 2>/dev/null || echo "0")
    if [ "$UNCHECKED" -gt 0 ]; then
      echo "  ⚠️  $dod: 有 $UNCHECKED 个未完成验收项（- [ ]），合并前需勾选为 - [x]"
    fi
  done <<< "$DOD_FILES"

  if [ -n "$(find . -maxdepth 2 -name ".dod-*.md" 2>/dev/null | grep -v ".claude/worktrees")" ]; then
    if [ "$DOD_OK" = "true" ]; then
      echo "  ✅ DoD 格式检查通过"
    else
      PASS=false
    fi
  fi

  # 运行 check-dod-mapping（如果 engine 依赖已安装）
  if [ -f "packages/engine/scripts/devgate/check-dod-mapping.cjs" ] && \
     [ -d "packages/engine/node_modules" ]; then
    echo ""
    echo "  运行 DoD 映射检查..."
    if node packages/engine/scripts/devgate/check-dod-mapping.cjs 2>/dev/null; then
      echo "  ✅ DoD 映射检查通过"
    else
      echo "  ❌ DoD 映射检查失败"
      PASS=false
    fi
  fi
else
  echo "  ⏭  无 DoD 文件，跳过"
fi
echo ""

# ─────────────────────────────────────────
# 检查 4：Facts 一致性（仅 Brain 有改动时）
# ─────────────────────────────────────────
echo "[4/4] Facts 一致性检查（Brain）"

if [ "$BRAIN_CHANGED" = "true" ] && [ -f "scripts/facts-check.mjs" ]; then
  if node scripts/facts-check.mjs 2>/dev/null; then
    echo "  ✅ Facts 一致性通过"
  else
    echo "  ❌ Facts 一致性失败（DEFINITION.md 与代码不一致）"
    echo "     修复: 同步 DEFINITION.md 与 packages/brain/src/ 代码"
    PASS=false
  fi
else
  echo "  ⏭  无 Brain 改动，跳过"
fi
echo ""

# ─────────────────────────────────────────
# 结果
# ─────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$PASS" = "true" ]; then
  echo "  ✅ Pre-Push 预检通过，可以推送"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "  ❌ Pre-Push 预检失败，请修复上述问题后再推送"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
