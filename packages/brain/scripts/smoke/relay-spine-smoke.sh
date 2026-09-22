#!/usr/bin/env bash
# relay-spine-smoke — 接力棒 PR1 脊柱真库火：真列落地、project 类型放开、FK 在、链上下文可拼、派发 prompt 已接注入。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

[[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='tasks' AND column_name IN ('parent_task_id','sequence_no')")" == "2" ]] || fail "parent_task_id/sequence_no 真列缺失"
pass "migration 458：parent_task_id / sequence_no 真列落地"

[[ "$(q "SELECT count(*) FROM pg_constraint WHERE conname='tasks_parent_task_id_fkey'")" == "1" ]] || fail "自引用 FK 缺失"
pass "tasks_parent_task_id_fkey 在"

[[ "$(q "SELECT (pg_get_constraintdef(oid) LIKE '%''project''%') FROM pg_constraint WHERE conrelid='tasks'::regclass AND conname='tasks_task_type_check'")" == "t" ]] || fail "task_type 约束未放开 project"
pass "task_type 放开 project"

TAG="$RANDOM$RANDOM"
ROOT="$(q "INSERT INTO tasks (title, description, task_type, status) VALUES ('smoke 接力棒根 $TAG', '目标：smoke', 'project', 'in_progress') RETURNING id")"
CHILD="$(q "INSERT INTO tasks (title, task_type, status, parent_task_id, sequence_no) VALUES ('smoke 第一棒 $TAG', 'data', 'queued', '$ROOT', 1) RETURNING id")"
trap 'q "DELETE FROM tasks WHERE id IN ('"'"'$CHILD'"'"','"'"'$ROOT'"'"')" >/dev/null 2>&1 || true' EXIT

"$NODE" --input-type=module -e "
import pg from 'pg';
import { getChainContext, formatChainForPrompt } from '$BRAIN_DIR/src/handoff.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ctx = await getChainContext({ pool }, '$CHILD');
await pool.end();
if (!ctx || ctx.root.id !== '$ROOT' || !ctx.is_chained) { console.error('链上下文找不到根', ctx); process.exit(1); }
const txt = formatChainForPrompt(ctx);
if (!txt.includes('smoke 接力棒根') || !txt.includes('目标：smoke') || !txt.includes('kind=task|decision|done')) { console.error('prompt 段缺关键内容', txt); process.exit(1); }
" || fail "链上下文拼装失败"
pass "getChainContext 沿真列找到根，formatChainForPrompt 含根/目标/规矩"

grep -q "buildChainPromptSafe({ pool }, task.id)" "$BRAIN_DIR/src/harness-skill-relay.js" || fail "派发 prompt 未接链上下文"
[[ "$(grep -c "= buildRelayPrompt({" "$BRAIN_DIR/src/harness-skill-relay.js")" == "2" ]] || fail "两处派发 prompt 应各走一次 buildRelayPrompt"
pass "harness-skill-relay 两处派发 prompt 已注入链上下文"

echo "ALL PASS: relay-spine"
