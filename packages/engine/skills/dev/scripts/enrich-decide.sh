#!/usr/bin/env bash
# enrich-decide.sh — 判断 PRD 是否需要 enrich
# 输入: PRD 文件路径（通过 $1）
# 输出: exit 0 = rich (skip enrich), exit 1 = thin (run enrich)
# 用法: bash enrich-decide.sh <prd-file>

set -uo pipefail

PRD_FILE="${1:-}"
[[ -z "$PRD_FILE" || ! -f "$PRD_FILE" ]] && exit 1

# 条件 1: 长度 >= 500 字节
_size=$(wc -c < "$PRD_FILE" | tr -d ' ')
[[ "$_size" -lt 500 ]] && exit 1

# 条件 2: 含 "## 成功标准" section
grep -qE '^##\s*成功标准' "$PRD_FILE" || exit 1

# 条件 3: 含 "## 不做" section
grep -qE '^##\s*不做' "$PRD_FILE" || exit 1

# 全部满足 = rich，无需 enrich
exit 0
