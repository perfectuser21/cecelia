#!/usr/bin/env bash
# Smoke: 派发时重锚定 base_sha 在位（任务 d9c405e2 / 决策 49035988）——
#   ① 迁移 465 三件套：anchor_generation 列 / supersedes 唯一键 / current_task 裸列索引
#   ② 重锚定模块真能被 Node 加载，且导出 reanchorReceiptIfEmptyBranch / HAS_ANY_RUN_SQL /
#      REANCHOR_EVIDENCE_KEYS（不是语法坏掉的空壳，也不是只剩注释的残件）
#   ③ dispatcher 的 needs_rebase 停车失败告警在位（停不下来必须喊人，不能静默重撞）
#   ④ 有 DB 环境时查真库：列与索引确已落地（只 grep 迁移文件挡不住"迁移没跑"）
# 路径双候选：容器内 /app/... 与仓库相对路径。
set -euo pipefail
printf '%s\n' "▶️  smoke: reanchor-base-sha-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

pick_file() {
  for cand in "$@"; do
    if [ -f "$cand" ]; then printf '%s\n' "$cand"; return 0; fi
  done
  return 1
}

# ① 迁移 465
MIG=$(pick_file \
  "/app/migrations/465_work_routing_receipt_supersession.sql" \
  "$SCRIPT_DIR/../../migrations/465_work_routing_receipt_supersession.sql") \
  || { echo "❌ 迁移 465_work_routing_receipt_supersession.sql 不存在"; exit 1; }
for token in anchor_generation work_routing_receipts_supersedes_unique idx_initiative_runs_current_task; do
  grep -q "$token" "$MIG" || { echo "❌ 迁移 465 缺 $token"; exit 1; }
done
echo "  ✅ 迁移 465 三件套在位: ${MIG}"

# ② 重锚定模块真可加载 + 三个导出在位
MOD=$(pick_file \
  "/app/src/orchestrator/preflight/base-sha-reanchor.js" \
  "$SCRIPT_DIR/../../src/orchestrator/preflight/base-sha-reanchor.js") \
  || { echo "❌ src/orchestrator/preflight/base-sha-reanchor.js 不存在"; exit 1; }
node --input-type=module -e "
import('file://$MOD').then((m) => {
  if (typeof m.reanchorReceiptIfEmptyBranch !== 'function') { console.error('reanchorReceiptIfEmptyBranch 不是函数'); process.exit(1); }
  if (typeof m.HAS_ANY_RUN_SQL !== 'string' || !/AS has_any_run/.test(m.HAS_ANY_RUN_SQL)) { console.error('HAS_ANY_RUN_SQL 缺失或不含 AS has_any_run'); process.exit(1); }
  if (!Array.isArray(m.REANCHOR_EVIDENCE_KEYS) || !m.REANCHOR_EVIDENCE_KEYS.includes('base_sha')) { console.error('REANCHOR_EVIDENCE_KEYS 缺失或不含 base_sha'); process.exit(1); }
}).catch((e) => { console.error(e.message); process.exit(1); });
" || { echo "❌ base-sha-reanchor 模块加载失败或导出不全"; exit 1; }
echo "  ✅ base-sha-reanchor 真加载通过: ${MOD}"

# ③ dispatcher 停车失败告警
DISP=$(pick_file \
  "/app/src/dispatcher.js" \
  "$SCRIPT_DIR/../../src/dispatcher.js") \
  || { echo "❌ src/dispatcher.js 不存在"; exit 1; }
grep -q "needs_rebase_park_failed" "$DISP" || { echo "❌ dispatcher 缺 needs_rebase_park_failed 告警"; exit 1; }
echo "  ✅ dispatcher needs_rebase 停车失败告警在位"

# ④ 真库检（无库环境跳过，不算失败）
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -n "${DB_NAME:-}" ]; then
  DB_URL="postgresql://${DB_USER:-cecelia}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME}"
fi
if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  COL=$(psql "$DB_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name='work_routing_receipts' AND column_name='anchor_generation'")
  [ "$COL" = "1" ] || { echo "❌ 库内 work_routing_receipts.anchor_generation 缺失（迁移 465 未跑）"; exit 1; }
  IDX=$(psql "$DB_URL" -Atc "SELECT count(*) FROM pg_indexes WHERE indexname='idx_initiative_runs_current_task'")
  [ "$IDX" = "1" ] || { echo "❌ 库内 idx_initiative_runs_current_task 缺失（迁移 465 未跑）"; exit 1; }
  echo "  ✅ 真库检通过：anchor_generation 列 + idx_initiative_runs_current_task"
else
  echo "⏭ 无 DB，跳过库检"
fi

echo "✅ reanchor-base-sha-smoke OK"
