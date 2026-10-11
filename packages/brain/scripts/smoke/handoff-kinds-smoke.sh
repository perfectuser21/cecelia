#!/usr/bin/env bash
# handoff-kinds-smoke — handoff 下一步四类真库火（主理人 2026-10-11 决策）：
# 有头任务 resume_headed 不派单、原任务挂 pending_resume；dispatch_headless 建 queued 子任务；未标字符串默认 resume_headed。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

TAG="$RANDOM$RANDOM"
HEADED="$(q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('smoke 有头续接 $TAG', 'data', 'completed', 'P2', '{\"headed_manual\":\"true\"}'::jsonb) RETURNING id")"
trap 'q "UPDATE tasks SET status=$$cancelled$$ WHERE parent_task_id=$$'"$HEADED"'$$; DELETE FROM tasks WHERE id=$$'"$HEADED"'$$" >/dev/null 2>&1 || true' EXIT

"$NODE" --input-type=module -e "
import pg from 'pg';
import { saveHandoff, buildHandoff } from '$BRAIN_DIR/src/handoff.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await saveHandoff({ pool }, buildHandoff({ task_id: '$HEADED', title: 'smoke', verdict: 'PASS', done: ['a'], next_steps: [
  { kind: 'resume_headed', title: 'smoke 有头接着做 $TAG' }, { kind: 'dispatch_headless', title: 'smoke 无头派 $TAG' }, 'smoke 未标 $TAG'] }));
const kids = await pool.query('SELECT title, status FROM tasks WHERE parent_task_id=\$1', ['$HEADED']);
if (kids.rows.length !== 1 || kids.rows[0].status !== 'queued' || !kids.rows[0].title.includes('无头派')) { console.error('只应建 1 条无头子任务', kids.rows); process.exit(1); }
const pr = (await pool.query(\"SELECT result->'pending_resume' AS p FROM tasks WHERE id=\$1\", ['$HEADED'])).rows[0].p;
if (!pr || pr.status !== 'pending' || pr.items.length !== 2) { console.error('pending_resume 未按预期挂', pr); process.exit(1); }
await pool.end();
" || fail "四类接棒链路失败"
pass "有头 handoff：resume_headed + 未标字符串 → 待续（不派单），dispatch_headless → 1 条 queued 子任务"

grep -q "router.get('/pending-resume'" "$BRAIN_DIR/src/routes/handoffs.js" || fail "缺 GET /handoffs/pending-resume"
grep -q "prepareHandoffForWrite" "$BRAIN_DIR/src/routes/tasks.js" || fail "PATCH 未接 handoff next_steps 规范化反馈"
pass "待续列表接口与 PATCH 反馈已接"

echo "ALL PASS: handoff-kinds"
