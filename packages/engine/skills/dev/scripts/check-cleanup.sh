#!/usr/bin/env bash
# check-cleanup.sh — /dev Stage 4 完工清理检查
# 检查 engine 脚本里是否存在孤岛引用（source/bash 调用了不存在的文件）
# 在 04-ship.md Stage 4 执行，PR 合并前最后一道人工检查
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ISSUES=0

echo "=== Engine 完工清理检查 ==="
echo ""

# ── 1. 检查 regression-contract.yaml 里的幽灵测试引用 ──────────────────────
echo "【1】regression-contract.yaml 测试引用完整性"
CONTRACT="$ENGINE_DIR/regression-contract.yaml"
if [[ -f "$CONTRACT" ]]; then
    MISSING_REFS=0
    while IFS= read -r path; do
        if [[ ! -f "$ENGINE_DIR/$path" ]]; then
            echo "  ❌ MISSING: $path"
            MISSING_REFS=$((MISSING_REFS + 1))
            ISSUES=$((ISSUES + 1))
        fi
    done < <(grep -E '^\s+test: "tests/' "$CONTRACT" | sed 's/.*test: "//; s/".*//' | sort -u)
    [[ $MISSING_REFS -eq 0 ]] && echo "  ✅ 无幽灵引用"
else
    echo "  ⚠️  regression-contract.yaml 不存在，跳过"
fi

echo ""

# ── 2. 检查 .sh 文件里 source/bash 调用的路径是否存在（仅硬引用，忽略条件判断）─
echo "【2】Shell 脚本硬引用完整性（跳过 if [[ -f ]] 条件块）"
SHELL_ISSUES=0
while IFS= read -r sh_file; do
    rel_file="${sh_file#$ENGINE_DIR/}"
    # 找 "source X" 或 "bash X" 或 ". X" 的硬引用（不在 if [[ -f 行）
    while IFS= read -r line; do
        # 跳过注释行
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        # 提取被引用路径（简单模式）
        ref=""
        if [[ "$line" =~ source[[:space:]]+\"?([^\"[:space:]]+)\"? ]]; then
            ref="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ bash[[:space:]]+\"?([^\"[:space:]|&]+)\"? ]]; then
            ref="${BASH_REMATCH[1]}"
        fi
        [[ -z "$ref" ]] && continue
        # 只检查以 $ 开头的相对路径（展开后可能有效），跳过
        [[ "$ref" == \$* ]] && continue
        # 检查绝对路径
        if [[ "$ref" == /* && ! -f "$ref" ]]; then
            echo "  ❌ $rel_file: 引用不存在 $ref"
            SHELL_ISSUES=$((SHELL_ISSUES + 1))
            ISSUES=$((ISSUES + 1))
        fi
    done < "$sh_file"
done < <(find "$ENGINE_DIR/hooks" "$ENGINE_DIR/lib" "$ENGINE_DIR/skills/dev/scripts" -name "*.sh" 2>/dev/null)
[[ $SHELL_ISSUES -eq 0 ]] && echo "  ✅ 无硬引用问题"

echo ""

# ── 3. 检查版本文件同步 ──────────────────────────────────────────────────────
echo "【3】Engine 版本文件同步（6 个文件）"
VER=$(cat "$ENGINE_DIR/VERSION" 2>/dev/null || echo "")
V_HOOK=$(cat "$ENGINE_DIR/hooks/VERSION" 2>/dev/null || echo "")
V_CORE=$(cat "$ENGINE_DIR/.hook-core-version" 2>/dev/null || echo "")
V_PKG=$(node -e "console.log(require('$ENGINE_DIR/package.json').version)" 2>/dev/null || echo "")
V_CONTRACT=$(grep "^version:" "$ENGINE_DIR/regression-contract.yaml" 2>/dev/null | awk '{print $2}' || echo "")

MISMATCH=0
for v in "$V_HOOK" "$V_CORE" "$V_PKG" "$V_CONTRACT"; do
    [[ "$v" != "$VER" ]] && { echo "  ❌ 版本不一致: $VER vs $v"; MISMATCH=$((MISMATCH+1)); ISSUES=$((ISSUES+1)); }
done
[[ $MISMATCH -eq 0 ]] && echo "  ✅ 版本同步 ($VER)"

echo ""
echo "================================"
if [[ $ISSUES -gt 0 ]]; then
    echo "❌ 发现 $ISSUES 个问题，请修复后再合并 PR"
    exit 1
fi
echo "✅ 完工检查通过，可以合并 PR"
