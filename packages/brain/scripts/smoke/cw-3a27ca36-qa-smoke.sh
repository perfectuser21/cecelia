#!/usr/bin/env bash
# coding workflow 任务 3a27ca36-7be9-4efc-a27f-18361dae6557 的真人 QA 验收命令固化（审计 #9）：QA 与独立裁判通过后由 runner 生成，勿手改
# 场景按 spec 要求自己造数据，CI 空库可复现；失败即回归。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "== T-7（对应 Q-5）"
if ! (
set -o pipefail; PREVIEW_URL="$BRAIN_URL"; curl -q -fsS "$PREVIEW_URL/api/brain/health" | jq -e --arg sha "$(git rev-parse HEAD)" '{status,git_sha,sha_matches:(.git_sha==$sha)} | select(.sha_matches == true)'
); then echo "FAIL: T-7" >&2; exit 1; fi

echo "PASS: cw-3a27ca36-qa-smoke.sh"
