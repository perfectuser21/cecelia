#!/usr/bin/env bash
# Shared Shell Helpers for W8 Acceptance contract verification (round 3).
# Sourced by:
#   - sprints/w8-langgraph-acceptance/contract-draft.md §Step 2 验证命令
#   - sprints/w8-langgraph-acceptance/contract-draft.md §Step 5 验证命令
#   - sprints/w8-langgraph-acceptance/contract-draft.md §E2E 验收（最终 Evaluator 跑）
# 目的：消除 fallback SQL / Brain 重启时序兜底逻辑在合同两处粘贴漂移（Reviewer R4 / R3 / R2）。
#
# 严禁内联同等 SQL；任何调用方都必须 `source` 此文件后通过函数调用。
#
# 全局变量约定：
#   $DB                — psql 连接串，必填
#   $STAGING_BRAIN     — staging Brain URL，默认 http://localhost:5222
#   $BRAIN_CONTAINER   — staging Brain docker 容器名，默认 cecelia-brain-staging

set -u

# ---------------------------------------------------------------------------
# helper-1 (R4): 计数 langgraph_checkpoints 表上去重后的 nodeName（COALESCE 三路兜底）
# Args:  $1 thread_id    $2 window (默认 "60 minutes")
# Echo:  数字（去除空白）；thread_id 空时回 0
# ---------------------------------------------------------------------------
count_distinct_nodes_in_checkpoints() {
  local thread_id="${1:-}"
  local window="${2:-60 minutes}"
  if [ -z "$thread_id" ]; then
    echo "0"
    return 0
  fi
  psql "$DB" -At -c "
    SELECT count(DISTINCT COALESCE(
             metadata->>'source',
             metadata->'writes'->-1->>0,
             checkpoint->'channel_values'->>'__node__'
           ))
      FROM langgraph_checkpoints
     WHERE thread_id='${thread_id}'
       AND created_at > NOW() - interval '${window}'
  " | tr -d ' '
}

# ---------------------------------------------------------------------------
# helper-2 (R4): 列出 langgraph_checkpoints 表上去重后的 nodeName 集合（逗号分隔，按字母序）
# Args:  $1 thread_id    $2 window (默认 "60 minutes")
# Echo:  逗号分隔字符串；thread_id 空时 echo ""
# ---------------------------------------------------------------------------
list_distinct_nodes_in_checkpoints() {
  local thread_id="${1:-}"
  local window="${2:-60 minutes}"
  if [ -z "$thread_id" ]; then
    echo ""
    return 0
  fi
  psql "$DB" -At -c "
    SELECT string_agg(DISTINCT COALESCE(
             metadata->>'source',
             metadata->'writes'->-1->>0,
             checkpoint->'channel_values'->>'__node__'
           ), ',' ORDER BY 1)
      FROM langgraph_checkpoints
     WHERE thread_id='${thread_id}'
       AND created_at > NOW() - interval '${window}'
  "
}

# ---------------------------------------------------------------------------
# helper-3 (R2): COALESCE 三路全 NULL 时 dump 一条 metadata + channel_values jsonb 全文
# 调用方先判定 fallback 行存在但 distinct=0 时再调用本函数
# Args:  $1 thread_id
# ---------------------------------------------------------------------------
dump_checkpoint_metadata_sample() {
  local thread_id="${1:-}"
  if [ -z "$thread_id" ]; then
    echo "[dump_checkpoint_metadata_sample] empty thread_id, skip"
    return 0
  fi
  echo "[dump_checkpoint_metadata_sample] thread_id=$thread_id"
  echo "[dump_checkpoint_metadata_sample] sample metadata jsonb ↓"
  psql "$DB" -At -c "
    SELECT jsonb_pretty(metadata)
      FROM langgraph_checkpoints
     WHERE thread_id='${thread_id}'
     LIMIT 1
  "
  echo "[dump_checkpoint_metadata_sample] sample checkpoint->channel_values ↓"
  psql "$DB" -At -c "
    SELECT jsonb_pretty(checkpoint->'channel_values')
      FROM langgraph_checkpoints
     WHERE thread_id='${thread_id}'
     LIMIT 1
  "
}

# ---------------------------------------------------------------------------
# helper-4 (R3): staging Brain 重启时序兜底 — curl /health 失败时先比对 mergedAt vs StartedAt
#
# 行为：
#   - curl 成功（HTTP 200） → echo body 返回 0
#   - curl 失败：比对 gh pr view mergedAt 与 docker inspect StartedAt
#       * StartedAt < mergedAt → brain 仍在跑老镜像，sleep 10 后重试（最多 3 轮）
#       * StartedAt >= mergedAt 但仍 404 → 新镜像里就没 handler，exit 1
#   - 取不到 mergedAt 或 StartedAt → exit 1（环境异常）
#   - 3 轮仍 404 → exit 1 + 打印两时间戳
#
# Args:  $1 staging_url   $2 pr_num   $3 brain_container (默认 cecelia-brain-staging)
# Stdout: 成功时 echo response body
# ---------------------------------------------------------------------------
wait_for_brain_with_pr_merge() {
  local staging_url="${1:-}"
  local pr_num="${2:-}"
  local brain_container="${3:-${BRAIN_CONTAINER:-cecelia-brain-staging}}"
  local max_attempts="${WAIT_BRAIN_MAX_ATTEMPTS:-3}"
  local sleep_sec="${WAIT_BRAIN_SLEEP_SEC:-10}"

  if [ -z "$staging_url" ] || [ -z "$pr_num" ]; then
    echo "FAIL wait_for_brain_with_pr_merge: staging_url 或 pr_num 为空（staging_url='$staging_url' pr_num='$pr_num'）" >&2
    exit 1
  fi

  local attempt=1
  local resp=""
  local merged_at=""
  local started_at=""
  local merged_ts=0
  local started_ts=0

  while [ "$attempt" -le "$max_attempts" ]; do
    if resp=$(curl -fsS "${staging_url}/api/brain/harness/health" 2>/dev/null); then
      echo "$resp"
      return 0
    fi

    merged_at=$(gh pr view "$pr_num" --json mergedAt -q .mergedAt 2>/dev/null || echo "")
    started_at=$(docker inspect "$brain_container" --format '{{.State.StartedAt}}' 2>/dev/null || echo "")
    echo "[wait_for_brain] attempt=$attempt curl 失败 brain.StartedAt=$started_at pr.mergedAt=$merged_at" >&2

    if [ -z "$merged_at" ] || [ -z "$started_at" ]; then
      echo "FAIL wait_for_brain_with_pr_merge: 取不到 mergedAt 或 StartedAt（merged_at='$merged_at' started_at='$started_at'）" >&2
      exit 1
    fi

    merged_ts=$(date -d "$merged_at" +%s 2>/dev/null || echo "0")
    started_ts=$(date -d "$started_at" +%s 2>/dev/null || echo "0")

    if [ "$started_ts" -lt "$merged_ts" ]; then
      echo "[wait_for_brain] brain 启动早于 PR merge（started_ts=$started_ts < merged_ts=$merged_ts），sleep ${sleep_sec}s 后重试" >&2
      sleep "$sleep_sec"
      attempt=$((attempt + 1))
      continue
    else
      echo "FAIL wait_for_brain_with_pr_merge: brain.StartedAt($started_at) >= pr.mergedAt($merged_at) 但 /health 仍非 200" >&2
      echo "                                  这意味着新镜像里就没 health handler，重试无用" >&2
      exit 1
    fi
  done

  echo "FAIL wait_for_brain_with_pr_merge: 重试 $max_attempts 轮仍 404" >&2
  echo "                                  pr.mergedAt=$merged_at brain.StartedAt=$started_at" >&2
  exit 1
}

# 标记此文件已 source（防止重复 source 时覆盖意外副作用）
W8_ACCEPTANCE_HELPERS_LOADED=1
