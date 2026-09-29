#!/usr/bin/env bash
# notion-to-brain-retired.test.sh — 守卫：journeys/journey_features/journey_steps 的 Notion→Brain 反向直写脚本已退役
# 原因：notion_projection_map 判定 journeys/journey_features 为「大脑写、Notion 只读」镜子，反向脚本=双写冲突；journey_steps 已废弃。
# sync-issues.js 保留（Issues 是登记入口库）。
set -uo pipefail
ERRORS=0; PASS=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DIR="$REPO_ROOT/scripts/notion-to-brain"
SCAN="$REPO_ROOT/scripts/run-all-initial-scans.sh"

echo "=== notion-to-brain 反向直写脚本退役守卫 ==="
for f in sync-journeys.js sync-journey-features.js sync-journey-steps.js; do
  if [ -e "$DIR/$f" ]; then fail "$f 仍存在"; else pass "$f 已删除"; fi
  if grep -q "$f" "$SCAN"; then fail "run-all-initial-scans.sh 仍引用 $f"; else pass "run-all-initial-scans.sh 不再引用 $f"; fi
done
if [ -f "$DIR/sync-issues.js" ]; then pass "sync-issues.js 保留"; else fail "sync-issues.js 被误删"; fi

echo "通过 $PASS / 失败 $ERRORS"
[ "$ERRORS" -eq 0 ]
