#!/usr/bin/env bash
# coding workflow 任务 b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132 的真人 QA 验收命令固化（审计 #9）：QA 与独立裁判通过后由 runner 生成，勿手改
# 场景按 spec 要求自己造数据，CI 空库可复现；失败即回归。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "== T-4（对应 Q-5）"
if ! (
/bin/zsh -lc "curl -q -sS $BRAIN_URL/api/brain/health | jq -ec '{git_sha,status,runtime} | if .git_sha == \"0de9516e6e2bda82b5f5282ca737184b99bb99f4\" and .status == \"healthy\" and .runtime.isolated == true then . else error(\"preview_head_or_health_mismatch\") end'"
); then echo "FAIL: T-4" >&2; exit 1; fi

echo "PASS: cw-b3d6f213-qa-smoke.sh"
