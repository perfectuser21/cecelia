#!/usr/bin/env bash
# check-learning-format.sh — Learning Format Gate
#
# 检测 Learning 文件格式：
#   1. 必须包含 ### 根本原因 章节
#   2. 检测同名文件 diff context 陷阱（### 根本原因 出现在 diff context 而非新增行）
#
# 用法：
#   bash packages/engine/ci/scripts/check-learning-format.sh [learning-file]
#   不传参数时，自动扫描 docs/learnings/ 目录下 PR 对应的文件
#
# 修复提示（同名文件陷阱）：
#   当 ### 根本原因 出现在 diff context（非 + 行）时，CI 无法检测到该章节。
#   解决方案：创建新文件（per-branch 命名），而非修改已有的同名文件。
#   正确命名：docs/learnings/cp-MMDDHHNN-branch-name.md

set -euo pipefail

PASS_COUNT=0
FAIL_COUNT=0
ERRORS=()

_pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
_fail() { echo "FAIL: $1" >&2; ERRORS+=("$1"); FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ─── 找 Learning 文件 ────────────────────────────────────────────
LEARNING_FILE="${1:-}"

if [[ -z "$LEARNING_FILE" ]]; then
    # 自动扫描：查找最新修改的 docs/learnings/*.md
    LEARNING_FILE=$(find docs/learnings -name "*.md" -newer packages/engine/ci/scripts/check-learning-format.sh 2>/dev/null | head -1 || true)
fi

if [[ -z "$LEARNING_FILE" || ! -f "$LEARNING_FILE" ]]; then
    # 找不到文件时跳过（不阻断 CI）
    echo "SKIP: 未找到 Learning 文件，跳过格式检查"
    exit 0
fi

echo "📋 检查 Learning 文件: $LEARNING_FILE"
CONTENT=$(cat "$LEARNING_FILE")

# ─── 检测 1：必须包含 ### 根本原因 章节 ─────────────────────────
if echo "$CONTENT" | grep -q '### 根本原因'; then
    _pass "文件包含 '### 根本原因' 章节"
else
    _fail "缺少 '### 根本原因' 章节（Learning 格式要求：必须含根本原因分析）"
fi

# ─── 检测 2：必须包含 ### 下次预防 章节 ──────────────────────────
if echo "$CONTENT" | grep -q '### 下次预防'; then
    _pass "文件包含 '### 下次预防' 章节"
else
    _fail "缺少 '### 下次预防' 章节（Learning 格式要求：必须含预防措施）"
fi

# ─── 检测 3：必须包含至少一个 checklist 项 ─────────────────────────
if echo "$CONTENT" | grep -qE '^\- \[[ x]\]'; then
    _pass "文件包含 checklist 项（- [ ] 或 - [x]）"
else
    _fail "缺少 checklist 项（下次预防必须包含 - [ ] 条目）"
fi

# ─── 检测 4：同名文件 diff context 陷阱检测 ─────────────────────────
# 若文件命名不是 per-branch 格式（cp-MMDDHHNN-），警告可能存在陷阱
FILENAME=$(basename "$LEARNING_FILE")
if echo "$FILENAME" | grep -qE '^cp-[0-9]{8}-'; then
    _pass "文件命名符合 per-branch 格式（cp-MMDDHHNN-*），不存在同名文件陷阱"
else
    # 非 per-branch 格式：检查 git diff 中该文件的 ### 根本原因 是否为新增行
    if git diff --cached -- "$LEARNING_FILE" 2>/dev/null | grep -q '^+.*### 根本原因'; then
        _pass "git diff 中 '### 根本原因' 为新增行（+ 行），无 diff context 陷阱"
    elif git diff --cached -- "$LEARNING_FILE" 2>/dev/null | grep -q '### 根本原因'; then
        _fail "同名文件 diff context 陷阱：'### 根本原因' 出现在 diff context（非 + 行）。" \
              "修复方案：创建新文件（per-branch 命名），而非修改已有的同名文件。" \
              "示例：docs/learnings/cp-$(date +%m%d%H%M)-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'branch').md"
    else
        # 文件未在 staging 区，或是全新文件，给出警告
        echo "WARN: 文件 '$FILENAME' 不是 per-branch 格式（cp-MMDDHHNN-*）。"
        echo "      若该文件在 main 中已存在同名版本，可能触发 diff context 陷阱。"
        echo "      建议：创建新文件（per-branch 命名）以确保 '### 根本原因' 为新增行。"
        _pass "当前文件未检测到 diff context 陷阱（staging 区无冲突）"
    fi
fi

# ─── 汇总 ─────────────────────────────────────────────────────────
echo ""
echo "Learning Format Gate 结果：PASS ${PASS_COUNT}  FAIL ${FAIL_COUNT}"

if [[ ${FAIL_COUNT} -gt 0 ]]; then
    echo ""
    echo "❌ 检测失败项："
    for err in "${ERRORS[@]}"; do
        echo "   - $err"
    done
    echo ""
    echo "💡 同名文件陷阱修复方法："
    echo "   若 '### 根本原因' 章节已在 main 中存在，CI diff 看到的是 context 行（非新增行）。"
    echo "   解决：请创建新文件（per-branch 命名），而非修改原文件："
    echo "   docs/learnings/cp-MMDDHHNN-branch-name.md"
    exit 1
fi

exit 0
