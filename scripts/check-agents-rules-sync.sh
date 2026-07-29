#!/usr/bin/env bash
# 校验 .claude/CLAUDE.md 与 AGENTS.md 里的硬规则摘要是否一致
set -euo pipefail

file_a="${1:-.claude/CLAUDE.md}"
file_b="${2:-AGENTS.md}"

extract_block() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    printf "❌ 文件不存在: %s\n" "$file" >&2
    exit 1
  fi
  sed -n '/<!-- HARD_RULES:BEGIN -->/,/<!-- HARD_RULES:END -->/p' "$file"
}

block_a=$(extract_block "$file_a")
block_b=$(extract_block "$file_b")

if [[ -z "$block_a" ]]; then
  printf "❌ %s 里没有找到 HARD_RULES marker\n" "$file_a" >&2
  exit 1
fi
if [[ -z "$block_b" ]]; then
  printf "❌ %s 里没有找到 HARD_RULES marker\n" "$file_b" >&2
  exit 1
fi

if [[ "$block_a" == "$block_b" ]]; then
  printf "✅ %s 与 %s 的硬规则摘要一致\n" "$file_a" "$file_b"
  exit 0
else
  printf "❌ %s 与 %s 的硬规则摘要不一致，请同步（以 %s 为准复制进 %s）：\n" "$file_a" "$file_b" "$file_a" "$file_b"
  diff <(printf "%s\n" "$block_a") <(printf "%s\n" "$block_b") || true
  exit 1
fi
