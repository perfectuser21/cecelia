#!/usr/bin/env bash
# ============================================================================
# check-chinese-punctuation-bombs.sh
# 扫描 shell 脚本里 $var 紧跟中文全角标点的炸弹模式
# ============================================================================
# $var + 中文标点（，。（）！？：；、）在 bash set -u 下触发 unbound variable
# 修复: 加花括号 ${var}
#
# 用法:
#   bash check-chinese-punctuation-bombs.sh              # 扫描默认目录
#   bash check-chinese-punctuation-bombs.sh <file...>    # 扫描指定文件
# 退出码: 0 = 无命中, 1 = 有命中
# ============================================================================

set -uo pipefail

# 正则：$ + 变量名字符（含下划线）+ 中文全角标点
# 注意: grep -P 在 macOS 不可用, 用基础 ERE
PATTERN='\$[a-zA-Z_][a-zA-Z0-9_]*(，|。|（|）|！|？|：|；|、)'

# 决定扫描目标
TARGETS=()
if [[ $# -gt 0 ]]; then
    TARGETS=("$@")
else
    # 默认：packages/engine/**/*.sh + scripts/**/*.sh + hooks/**/*.sh
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    cd "$REPO_ROOT"
    # Use while loop instead of mapfile for bash 3.x compatibility (macOS)
    while IFS= read -r line; do
        TARGETS+=("$line")
    done < <(find packages/engine scripts hooks -type f -name "*.sh" 2>/dev/null)
fi

HIT_COUNT=0
# Phase 7.3: bash 3.2 set -u compat — guard 空数组（find 无输出 + 无参数时 TARGETS 为空）
for f in "${TARGETS[@]+${TARGETS[@]}}"; do
    [[ -f "$f" ]] || continue
    # -n 行号 -E 扩展正则
    while IFS= read -r line; do
        echo "$line"
        HIT_COUNT=$((HIT_COUNT + 1))
    done < <(grep -nE "$PATTERN" "$f" 2>/dev/null | sed "s|^|$f:|")
done

if [[ $HIT_COUNT -gt 0 ]]; then
    echo "" >&2
    echo "❌ 发现 $HIT_COUNT 处中文标点炸弹（\$var 紧跟中文标点）" >&2
    echo "   修复: 加花括号 \${var}" >&2
    exit 1
fi

exit 0
