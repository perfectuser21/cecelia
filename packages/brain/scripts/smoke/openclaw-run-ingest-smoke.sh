#!/usr/bin/env bash
# openclaw-run-ingest-smoke — OpenClaw 运行记录入 runs 表（迁移 532）真库只读验收：
# runs 表带 Notion 投影记账列 notion_id；库里已有 openclaw 行时，每行都带任务名（trigger_ref）与开始时间（started_at）。
# 全程只读（仅 SELECT），不写库、不发任何请求。CI 空库以「表与列存在」为通过；有 openclaw 行再校验字段非空。
set -uo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
q()    { psql -X "$DB" -v ON_ERROR_STOP=1 -qAtc "$1"; }

if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] SKIP: psql 不可用"; exit 0
fi
if ! psql -X "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP: DB 不可达"; exit 0
fi

# 1. 结构：runs 表与 Notion 记账列
if [[ "$(q "SELECT to_regclass('public.runs') IS NOT NULL")" == "t" ]]; then ok "runs 表存在"; else fail "runs 表不存在（迁移 531 未跑？）"; fi
for c in notion_id notion_synced_at notion_digest trigger_ref started_at; do
  if [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='runs' AND column_name='$c'")" == "1" ]]; then
    ok "runs.$c 列存在"
  else
    fail "runs 缺列 $c（迁移 532 未跑？）"
  fi
done

# 2. 有 openclaw 行时，逐行校验任务名与开始时间非空
if [[ "$FAIL" -eq 0 ]]; then
  total="$(q "SELECT count(*) FROM runs WHERE run_id LIKE 'openclaw:%'")"
  if [[ "$total" == "0" ]]; then
    echo "[smoke] runs 里暂无 openclaw 行（空库 / 采集未启动），跳过字段非空校验"
  else
    good="$(q "SELECT count(*) FROM runs WHERE run_id LIKE 'openclaw:%' AND trigger_ref IS NOT NULL AND started_at IS NOT NULL")"
    if [[ "$good" -gt 0 ]]; then ok "openclaw 行 $total 条，其中 $good 条带 trigger_ref 与 started_at"; else fail "openclaw 行 $total 条但没有一条同时带 trigger_ref 与 started_at"; fi
    bad="$(q "SELECT count(*) FROM runs WHERE run_id LIKE 'openclaw:%' AND (trigger_ref IS NULL OR started_at IS NULL)")"
    if [[ "$bad" == "0" ]]; then ok "无缺 trigger_ref / started_at 的 openclaw 行"; else fail "$bad 条 openclaw 行缺 trigger_ref 或 started_at"; fi
  fi
fi

echo "openclaw-run-ingest-smoke: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
