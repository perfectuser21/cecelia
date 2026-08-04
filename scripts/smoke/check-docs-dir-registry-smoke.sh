#!/usr/bin/env bash
# check-docs-dir-registry-smoke.sh
#
# docs/ 目录登记 smoke 检查（I-4 铁律）
#
# 规则：docs/ 一级子目录必须登记在 docs/current/docs-dir-baseline.txt。
# 祖父条款（I-5）：基线建立时的存量目录自动豁免；本脚本只拦未登记的新增目录。
#
# 用法：bash scripts/smoke/check-docs-dir-registry-smoke.sh
# 返回：0 = 全部已登记；1 = 发现未登记目录（CI 红）
set -euo pipefail

BASELINE="docs/current/docs-dir-baseline.txt"
DOCS_DIR="docs"

if [[ ! -f "$BASELINE" ]]; then
  printf "❌ 基线文件不存在: %s（请先运行 docs-dir-baseline.txt 生成脚本）\n" "$BASELINE" >&2
  exit 1
fi

if [[ ! -s "$BASELINE" ]]; then
  printf "❌ 基线文件为空: %s\n" "$BASELINE" >&2
  exit 1
fi

# 获取当前 docs/ 一级子目录
current_dirs=$(find "$DOCS_DIR" -maxdepth 1 -mindepth 1 -type d | sed "s|$DOCS_DIR/||" | sort)

FAIL=0

while IFS= read -r dir; do
  if ! grep -qxF "$dir" "$BASELINE"; then
    printf "❌ 未登记目录: %s/%s（请将其加入 %s 后提交）\n" "$DOCS_DIR" "$dir" "$BASELINE"
    FAIL=1
  fi
done <<< "$current_dirs"

if [[ "$FAIL" -eq 0 ]]; then
  printf "✅ docs/ 所有一级子目录均已登记在基线文件中\n"
  exit 0
else
  printf "❌ 发现未登记的 docs/ 子目录，CI 红（I-4 铁律）\n" >&2
  exit 1
fi
