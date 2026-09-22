#!/usr/bin/env bash
# relay-baton-smoke — 接力棒 PR2 接棒真库火：completed 无 handoff 自动合成；next_steps 落子任务与待拍板；PATCH 路由已接；stop hook 闸在。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"; REPO_DIR="$(cd "$BRAIN_DIR/../.." && pwd)"

TAG="$RANDOM$RANDOM"
ROOT="$(q "INSERT INTO tasks (title, description, task_type, status) VALUES ('smoke 接棒根 $TAG', '目标', 'project', 'in_progress') RETURNING id")"
FIRST="$(q "INSERT INTO tasks (title, task_type, status, priority, parent_task_id, sequence_no) VALUES ('smoke 接棒第一棒 $TAG', 'data', 'completed', 'P2', '$ROOT', 1) RETURNING id")"
trap 'q "UPDATE tasks SET status=$$cancelled$$ WHERE parent_task_id=$$'"$ROOT"'$$ AND id<>$$'"$FIRST"'$$; DELETE FROM decisions WHERE source_ref=$$'"$FIRST"'$$; DELETE FROM tasks WHERE id IN ($$'"$FIRST"'$$,$$'"$ROOT"'$$)" >/dev/null 2>&1 || true' EXIT

"$NODE" --input-type=module -e "
import pg from 'pg';
import { relayOnComplete } from '$BRAIN_DIR/src/lib/relay-baton.js';
import { saveHandoff, buildHandoff } from '$BRAIN_DIR/src/handoff.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r1 = await relayOnComplete(pool, '$FIRST');
if (!r1 || r1.synthesized !== true) { console.error('无 handoff 应合成', r1); process.exit(1); }
await saveHandoff({ pool }, buildHandoff({ task_id: '$FIRST', title: 'smoke', verdict: 'PASS', done: ['a'], next_steps: [
  { kind: 'task', title: 'smoke 第二棒 $TAG' }, { kind: 'decision', title: 'smoke 拍板 $TAG' }] }));
const kids = await pool.query('SELECT status, sequence_no, payload FROM tasks WHERE parent_task_id=\$1 AND id<>\$2', ['$ROOT', '$FIRST']);
if (kids.rows.length !== 1 || kids.rows[0].status !== 'queued' || kids.rows[0].sequence_no !== 2 || kids.rows[0].payload.lane !== 'AI') { console.error('子任务未按预期落', kids.rows); process.exit(1); }
const dec = await pool.query('SELECT status FROM decisions WHERE source_ref=\$1', ['$FIRST']);
if (dec.rows.length !== 1 || dec.rows[0].status !== 'pending') { console.error('待拍板未落', dec.rows); process.exit(1); }
await relayOnComplete(pool, '$FIRST');
const kids2 = await pool.query('SELECT count(*)::int AS n FROM tasks WHERE parent_task_id=\$1 AND id<>\$2', ['$ROOT', '$FIRST']);
if (kids2.rows[0].n !== 1) { console.error('重复触发不幂等'); process.exit(1); }
await pool.end();
" || fail "接棒链路失败"
pass "completed 无 handoff → 合成；next_steps task→queued 子任务挂根(seq=2, lane=AI)，decision→pending；重复触发幂等"

grep -q "relayOnComplete(pool, task_id" "$BRAIN_DIR/src/routes/tasks.js" || fail "PATCH 路由未接 relayOnComplete"
pass "PATCH /tasks/:id 收口已接接棒"

grep -q "接力棒闸" "$REPO_DIR/hooks/stop.sh" && bash -n "$REPO_DIR/hooks/stop.sh" || fail "stop.sh 缺接力棒闸或语法错"
pass "有头 stop hook：in_progress 无 handoff 不放行"

echo "ALL PASS: relay-baton"
