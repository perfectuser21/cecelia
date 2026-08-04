#!/usr/bin/env bash
# 三方对账：正本 packages/workflows/KERNEL_CONTEXT.md == AGENTS.md == .claude/CLAUDE.md
# 任一不等 exit 1
set -euo pipefail

KERNEL_FILE="packages/workflows/KERNEL_CONTEXT.md"
AGENTS_FILE="${1:-AGENTS.md}"
CLAUDE_FILE="${2:-.claude/CLAUDE.md}"

extract_block() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    printf "❌ 文件不存在: %s\n" "$file" >&2
    exit 1
  fi
  sed -n '/<!-- HARD_RULES:BEGIN -->/,/<!-- HARD_RULES:END -->/p' "$file"
}

block_kernel=$(extract_block "$KERNEL_FILE")
block_agents=$(extract_block "$AGENTS_FILE")
block_claude=$(extract_block "$CLAUDE_FILE")

if [[ -z "$block_kernel" ]]; then
  printf "❌ %s 里没有找到 HARD_RULES marker\n" "$KERNEL_FILE" >&2
  exit 1
fi
if [[ -z "$block_agents" ]]; then
  printf "❌ %s 里没有找到 HARD_RULES marker\n" "$AGENTS_FILE" >&2
  exit 1
fi
if [[ -z "$block_claude" ]]; then
  printf "❌ %s 里没有找到 HARD_RULES marker\n" "$CLAUDE_FILE" >&2
  exit 1
fi

FAIL=0

# 正本 vs AGENTS.md
if [[ "$block_kernel" == "$block_agents" ]]; then
  printf "✅ %s 与 %s 一致\n" "$KERNEL_FILE" "$AGENTS_FILE"
else
  printf "❌ %s 与 %s 不一致（以 %s 为正本）:\n" "$KERNEL_FILE" "$AGENTS_FILE" "$KERNEL_FILE"
  diff <(printf "%s\n" "$block_kernel") <(printf "%s\n" "$block_agents") || true
  FAIL=1
fi

# 正本 vs .claude/CLAUDE.md
if [[ "$block_kernel" == "$block_claude" ]]; then
  printf "✅ %s 与 %s 一致\n" "$KERNEL_FILE" "$CLAUDE_FILE"
else
  printf "❌ %s 与 %s 不一致（以 %s 为正本）:\n" "$KERNEL_FILE" "$CLAUDE_FILE" "$KERNEL_FILE"
  diff <(printf "%s\n" "$block_kernel") <(printf "%s\n" "$block_claude") || true
  FAIL=1
fi

if [[ "$FAIL" -eq 0 ]]; then
  printf "✅ 三方对账通过：正本 / AGENTS / CLAUDE 硬规则摘要完全一致\n"
  exit 0
else
  printf "❌ 三方对账失败：请以 %s 为正本，同步所有镜像副本\n" "$KERNEL_FILE" >&2
  exit 1
fi
