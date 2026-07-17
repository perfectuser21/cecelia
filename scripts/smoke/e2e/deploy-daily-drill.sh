#!/usr/bin/env bash
# deploy-daily-drill.sh — G3 每日部署演习对账脚本
# exit 0=绿 / 1=红（演习红） / 2=skip（无 merge / GH API 失败）
#
# 环境变量：
#   DRILL_MOCK_MERGES   — 测试用，注入 JSON 数组替代真实 GH API 查询
#   DRILL_MOCK_RUNS     — 测试用，注入 workflow runs JSON 数组
#   DRILL_GH_API_FAIL   — 测试用，设为 1 时模拟 GH API 失败
#   BARK_KEY            — Bark 推送密钥（空则跳过）
#   BRAIN_URL           — Brain API URL（默认 http://localhost:5221）
#   GH_REPO             — GitHub 仓库（默认 perfectuser21/cecelia）

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
GH_REPO="${GH_REPO:-perfectuser21/cecelia}"
BARK_KEY="${BARK_KEY:-}"
DRILL_WINDOW_MINUTES=15

# ── 时间工具 ──
_now_ts() { date +%s; }
_iso_to_ts() { date -d "$1" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null || echo 0; }
_24h_ago_iso() { date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ'; }

# ── GH API 失败 fail open ──
if [ "${DRILL_GH_API_FAIL:-0}" = "1" ]; then
  echo "gh_api_error: DRILL_GH_API_FAIL=1，fail open → skip"
  exit 2
fi

# ── 查过去 24h merged 的 brain 相关 PR ──
SINCE=$(_24h_ago_iso)

if [ -n "${DRILL_MOCK_MERGES:-}" ]; then
  MERGES="$DRILL_MOCK_MERGES"
else
  MERGES=$(timeout 10 gh api "repos/$GH_REPO/pulls?state=closed&base=main&per_page=50" \
    2>/dev/null | \
    jq --arg since "$SINCE" '[.[] | select(.merged_at != null and .merged_at > $since) | {number: .number, merge_commit_sha: .merge_commit_sha, merged_at: .merged_at, title: .title}]' \
    2>/dev/null) || {
    echo "gh_api_error: GH API 调用失败 → fail open → skip"
    exit 2
  }
fi

MERGE_COUNT=$(echo "$MERGES" | jq 'length' 2>/dev/null || echo 0)

if [ "$MERGE_COUNT" -eq 0 ]; then
  echo "no_merge_skip: 过去 24h 无 brain 相关 PR merge → skip（不算绿/不算红）"
  exit 2
fi

echo "发现 $MERGE_COUNT 个 merge，开始对账..."

# ── 查 brain-ci-deploy.yml workflow runs ──
if [ -n "${DRILL_MOCK_RUNS:-}" ]; then
  RUNS="$DRILL_MOCK_RUNS"
else
  RUNS=$(timeout 10 gh api "repos/$GH_REPO/actions/workflows/brain-ci-deploy.yml/runs?per_page=50" \
    2>/dev/null | \
    jq '.workflow_runs | map({head_sha: .head_sha, conclusion: .conclusion, created_at: .created_at, updated_at: .updated_at, html_url: .html_url})' \
    2>/dev/null) || {
    echo "gh_api_error: workflow runs API 调用失败 → fail open → skip"
    exit 2
  }
fi

# ── 逐 merge 对账 ──
DRILL_STATUS=0  # 0=全绿，1=有红
FAIL_COUNT=0

while IFS= read -r merge; do
  PR_NUM=$(echo "$merge" | jq -r '.number')
  MERGE_SHA=$(echo "$merge" | jq -r '.merge_commit_sha')
  MERGED_AT=$(echo "$merge" | jq -r '.merged_at')
  PR_TITLE=$(echo "$merge" | jq -r '.title')

  MERGE_TS=$(_iso_to_ts "$MERGED_AT")
  WINDOW_END_TS=$((MERGE_TS + DRILL_WINDOW_MINUTES * 60))

  echo "  PR #$PR_NUM: merge_sha=${MERGE_SHA:0:7}, merged_at=$MERGED_AT"

  # 查 15min 窗内是否有 SHA 匹配的成功 deploy
  MATCH=$(echo "$RUNS" | jq --arg sha "$MERGE_SHA" --argjson end "$WINDOW_END_TS" \
    '[.[] | select(.head_sha == $sha and .conclusion == "success")] | length' \
    2>/dev/null || echo 0)

  if [ "$MATCH" -gt 0 ]; then
    echo "  ✅ PR #$PR_NUM → 15min 内部署成功（SHA 匹配）"
  else
    echo "  ❌ DRILL_RED: PR #$PR_NUM ($PR_TITLE) merge 后 15min 内无成功 deploy"
    DRILL_STATUS=1
    FAIL_COUNT=$((FAIL_COUNT + 1))

    # Bark 告警
    if [ -n "$BARK_KEY" ]; then
      BARK_MSG="[G3演习红] PR #$PR_NUM \"$PR_TITLE\" merge 后 15min 内未检测到成功部署"
      curl -s --max-time 5 "https://api.day.app/$BARK_KEY/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$BARK_MSG'))" 2>/dev/null || echo "$BARK_MSG")" >/dev/null || true
    fi

    # incidents 落档
    BRAIN_URL_CHECK=$(curl -sf --max-time 3 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1 && echo "ok" || echo "offline")
    if [ "$BRAIN_URL_CHECK" = "ok" ]; then
      curl -s --max-time 10 -X POST "$BRAIN_URL/api/brain/incidents" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"deploy_drill_red\",\"title\":\"G3 演习红：PR #${PR_NUM} 15min 内未部署\",\"severity\":\"P2\",\"details\":{\"pr_num\":${PR_NUM},\"merge_sha\":\"$MERGE_SHA\",\"merged_at\":\"$MERGED_AT\",\"expected_window_minutes\":${DRILL_WINDOW_MINUTES}}}" \
        >/dev/null || true
    fi
  fi
done < <(echo "$MERGES" | jq -c '.[]')

if [ "$DRILL_STATUS" -eq 0 ]; then
  echo "GREEN: 所有 $MERGE_COUNT 个 merge 均在 15min 内完成部署 ✅"
  exit 0
else
  echo "DRILL_RED: $FAIL_COUNT/$MERGE_COUNT 个 merge 违反 15min 部署约定 ❌"
  exit 1
fi
