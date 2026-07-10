#!/usr/bin/env bash
# 刀C Release Gate — 查最近 auto-staging-deploy 绿证据
#
# Usage:
#   bash scripts/ci/release-gate-check.sh [HOURS_WINDOW]
#   HOURS_WINDOW 默认 24（小时）
#
# Env vars:
#   GH_TOKEN / GITHUB_TOKEN          — GitHub API token（CI 自动注入）
#   GITHUB_REPOSITORY                — owner/repo（CI 自动注入）
#   RELEASE_GATE_FIXTURE_JSON        — 测试专用：覆盖 GitHub API 返回的 JSON 文件路径
#
# Exit codes:
#   0 = 通过（有效绿证据存在）
#   1 = 失败（无有效绿证据）
set -uo pipefail

HOURS_WINDOW="${1:-24}"
WORKFLOW_FILE="auto-staging-deploy.yml"
REPO="${GITHUB_REPOSITORY:-}"

# ─── 获取 workflow runs JSON ───────────────────────────────────────────────

if [ -n "${RELEASE_GATE_FIXTURE_JSON:-}" ]; then
  # 测试模式：从 fixture 文件读取
  if [ ! -f "$RELEASE_GATE_FIXTURE_JSON" ]; then
    echo "::error::RELEASE_GATE_FIXTURE_JSON 文件不存在: $RELEASE_GATE_FIXTURE_JSON" >&2
    exit 1
  fi
  RUNS_JSON=$(cat "$RELEASE_GATE_FIXTURE_JSON" 2>/dev/null || echo "")
else
  # 生产模式：调用 GitHub API
  TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -z "$TOKEN" ]; then
    echo "::error::Release Gate：缺少 GH_TOKEN 或 GITHUB_TOKEN" >&2
    exit 1
  fi
  if [ -z "$REPO" ]; then
    echo "::error::Release Gate：缺少 GITHUB_REPOSITORY" >&2
    exit 1
  fi

  API_URL="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&per_page=10"
  RUNS_JSON=$(curl -sf \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$API_URL" 2>/dev/null || echo "")
fi

# ─── 解析并验证 ───────────────────────────────────────────────────────────

if ! echo "$RUNS_JSON" | python3 -c "import sys,json; json.load(sys.stdin)" >/dev/null 2>&1; then
  echo "::error::Release Gate：GitHub API 返回无效 JSON" >&2
  exit 1
fi

# 找最近一条 conclusion=success 的 run
LATEST_SUCCESS_JSON=$(echo "$RUNS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
runs = data.get('workflow_runs', [])
for r in runs:
    if r.get('conclusion') == 'success' and r.get('status') == 'completed':
        print(json.dumps({'id': r.get('id'), 'created_at': r.get('created_at', '')}))
        break
" 2>/dev/null || echo "")

if [ -z "$LATEST_SUCCESS_JSON" ]; then
  echo "::error::Release Gate 失败：未找到 ${WORKFLOW_FILE} 成功记录（branch=main）" >&2
  echo "  → 需要先有一次 auto-staging-deploy 成功才能放行生产部署" >&2
  exit 1
fi

RUN_ID=$(echo "$LATEST_SUCCESS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
CREATED_AT=$(echo "$LATEST_SUCCESS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['created_at'])" 2>/dev/null || echo "")

# 计算距今小时数
AGE_HOURS=$(python3 -c "
import sys
from datetime import datetime, timezone
created_str = '$CREATED_AT'.replace('Z', '+00:00')
try:
    created = datetime.fromisoformat(created_str)
    now = datetime.now(timezone.utc)
    diff_seconds = (now - created).total_seconds()
    print(int(diff_seconds / 3600))
except Exception as e:
    print(9999)
" 2>/dev/null || echo "9999")

if [ "$AGE_HOURS" -gt "$HOURS_WINDOW" ]; then
  echo "::error::Release Gate 失败：最近 ${WORKFLOW_FILE} 成功记录距今 ${AGE_HOURS}h，超过 ${HOURS_WINDOW}h 窗口" >&2
  echo "  → run_id=${RUN_ID}，created_at=${CREATED_AT}" >&2
  echo "  → 需要先有新的 auto-staging-deploy 成功记录才能放行生产部署" >&2
  exit 1
fi

echo "✅ Release Gate 通过：${WORKFLOW_FILE} run #${RUN_ID}（${CREATED_AT}，约 ${AGE_HOURS}h 前）"
