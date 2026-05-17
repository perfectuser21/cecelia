#!/usr/bin/env bash
# env-broken-recovery-smoke.sh
#
# 恢复 env_broken 失败任务 + 验证 /dev skill 可用性
#
# 用途：
#   1. 查询 DB 中因 env_skill_missing 失败的任务
#   2. 将它们 re-queue（重置为 queued 状态）
#   3. 验证 skill 路径配置正确
#
# 使用：
#   bash packages/brain/scripts/smoke/env-broken-recovery-smoke.sh [--dry-run]
#
# 环境变量：
#   DB_HOST / DB_PORT / DB_NAME / DB_USER / BRAIN_URL

set -euo pipefail

DRY_RUN="${1:-}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== env_broken 任务恢复脚本 ==="
echo "时间: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "模式: ${DRY_RUN:-live}"
echo ""

PASS=0
FAIL=0

check_pass() { echo "  [PASS] $1"; PASS=$((PASS+1)); }
check_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
check_skip() { echo "  [SKIP] $1"; }

# ── 1. 检查 Brain API 健康 ────────────────────────────────────────────────
echo "[1/4] 检查 Brain API..."
BRAIN_OK=false
if curl -sf --max-time 3 "${BRAIN_URL}/api/brain/health" >/dev/null 2>&1; then
  check_pass "Brain API 响应正常"
  BRAIN_OK=true
else
  check_skip "Brain API 未运行（跳过 API 检查）"
fi

# ── 2. 统计 env_broken 任务 ──────────────────────────────────────────────
echo ""
echo "[2/4] 查询近 24h env_broken 失败任务..."

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-cecelia}"
DB_USER="${DB_USER:-cecelia}"

DB_OK=false
ENV_SKILL_COUNT=0

if RESULT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At -c "
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE metadata->>'failure_class' = 'env_skill_missing') AS env_skill_missing
  FROM tasks
  WHERE status = 'failed'
    AND updated_at >= NOW() - INTERVAL '24 hours'
" 2>/dev/null); then
  TOTAL=$(echo "$RESULT" | cut -d'|' -f1)
  ENV_SKILL_COUNT=$(echo "$RESULT" | cut -d'|' -f2)
  check_pass "近24h 失败任务总计: ${TOTAL:-0}，其中 env_skill_missing: ${ENV_SKILL_COUNT:-0}"
  DB_OK=true
else
  check_skip "无法连接 DB（${DB_HOST}:${DB_PORT}/${DB_NAME}）"
fi

# ── 3. Re-queue env_broken 任务 ──────────────────────────────────────────
echo ""
echo "[3/4] Re-queue env_broken 任务..."

if [ "$DB_OK" = "true" ] && [ "${ENV_SKILL_COUNT:-0}" -gt "0" ]; then
  REQUEUE_SQL="
  UPDATE tasks
  SET status      = 'queued',
      claimed_by  = NULL,
      started_at  = NULL,
      updated_at  = NOW(),
      metadata    = metadata - 'env_broken_reason' - 'skill_missing',
      payload     = COALESCE(payload, '{}'::jsonb)
                    || jsonb_build_object('retry_reason', 'env_broken_recovery: skill path fixed at $(date -u +%Y-%m-%dT%H:%M:%SZ)')
  WHERE status = 'failed'
    AND updated_at >= NOW() - INTERVAL '24 hours'
    AND metadata->>'failure_class' = 'env_skill_missing'
  RETURNING id, task_type;"

  if [ "$DRY_RUN" = "--dry-run" ]; then
    check_pass "DRY-RUN: 将 re-queue ${ENV_SKILL_COUNT} 个 env_broken 任务（未实际执行）"
  else
    if REQUEUED=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$REQUEUE_SQL" 2>/dev/null); then
      REQUEUE_COUNT=$(echo "$REQUEUED" | grep -c "^(" || true)
      check_pass "Re-queued ${REQUEUE_COUNT} 个 env_broken 任务"
      echo "$REQUEUED" | grep "^(" | head -10 | sed 's/^/    /'
    else
      check_fail "Re-queue 失败（DB 操作错误）"
    fi
  fi
else
  check_skip "无 env_broken 任务需要恢复（count=${ENV_SKILL_COUNT:-0}）"
fi

# ── 4. 验证 skill 路径 ───────────────────────────────────────────────────
echo ""
echo "[4/4] 验证 engine skills 路径..."

SETTINGS_FILE="${HOME}/.claude/settings.json"
ENGINE_SKILL_PATH="/workspace/packages/engine/skills"

if [ -f "$SETTINGS_FILE" ]; then
  if grep -q "$ENGINE_SKILL_PATH" "$SETTINGS_FILE"; then
    check_pass "settings.json 包含 engine skills 路径"
  else
    check_fail "settings.json 未包含路径: $ENGINE_SKILL_PATH"
  fi
else
  check_fail "settings.json 不存在: $SETTINGS_FILE"
fi

for skill in dev engine-worktree engine-ship; do
  if [ -d "$ENGINE_SKILL_PATH/$skill" ]; then
    check_pass "skill /$skill 存在"
  else
    check_fail "skill /$skill 缺失: $ENGINE_SKILL_PATH/$skill"
  fi
done

# ── 汇总 ─────────────────────────────────────────────────────────────────
echo ""
echo "=== 结果: ${PASS} PASS / ${FAIL} FAIL ==="
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "修复步骤："
  echo "  1. 确认 ${HOME}/.claude/settings.json skills.paths 包含: $ENGINE_SKILL_PATH"
  echo "  2. 重启 Brain: pm2 restart brain"
  echo "  3. 重跑此脚本验证"
  exit 1
fi

if [ "$DB_OK" = "true" ]; then
  echo ""
  echo "后续步骤："
  echo "  1. 重启 Brain: pm2 restart brain（使新 settings 生效）"
  echo "  2. 观察队列: curl ${BRAIN_URL}/api/brain/tasks?status=queued"
  echo "  3. 目标：24h 成功率恢复至 90%+"
fi
