#!/usr/bin/env bash
# run-collision-check.sh — 隔离撞车检查逻辑，供测试用 mock gh 覆盖
#
# 用法: bash run-collision-check.sh <task_name>
#   task_name: 任务名（如 fix-dedup-temporal）
#
# 退出码:
#   0 — 无撞车，允许继续
#   1 — [COLLISION] 检测到已有 open/merged PR，阻止重复实现
#
# 环境变量 PATH 可被测试用 mock gh 覆盖

set -uo pipefail

task_name="${1:-}"

if [[ -z "$task_name" ]]; then
    echo "用法: $0 <task_name>" >&2
    exit 2
fi

# ── 1. 检查 open PR（原有逻辑） ──────────────────────────────────────
open_hit=$(gh pr list --state open --search "$task_name" \
    --json number,title,headRefName 2>/dev/null || echo "[]")

open_num=$(echo "$open_hit" | python3 -c "
import json, sys
data = json.load(sys.stdin)
hits = [p for p in data if '$task_name' in p.get('headRefName','') or '$task_name' in p.get('title','')]
print(hits[0]['number'] if hits else '')
" 2>/dev/null || echo "")

if [[ -n "$open_num" ]]; then
    echo "[COLLISION] 疑似已被 PR#${open_num} 完成——请核对后关闭本任务，禁止重复实现" >&2
    exit 1
fi

# ── 2. 检查近 7 天内 merged PR（新增修复） ──────────────────────────
merged_hit=$(gh pr list --state merged --search "$task_name" \
    --json number,title,mergedAt,headRefName 2>/dev/null || echo "[]")

collision_pr=$(echo "$merged_hit" | python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta

data = json.load(sys.stdin)
cutoff = datetime.now(timezone.utc) - timedelta(days=7)

for pr in data:
    merged_at_str = pr.get('mergedAt', '')
    if not merged_at_str:
        continue
    try:
        merged_at = datetime.fromisoformat(merged_at_str.replace('Z', '+00:00'))
    except Exception:
        continue
    name_match = '$task_name' in pr.get('headRefName', '') or '$task_name' in pr.get('title', '')
    if merged_at >= cutoff and name_match:
        print(pr['number'])
        break
" 2>/dev/null || echo "")

if [[ -n "$collision_pr" ]]; then
    echo "[COLLISION] 疑似已被 PR#${collision_pr} 完成——请核对后关闭本任务，禁止重复实现" >&2
    exit 1
fi

# 无撞车
exit 0
