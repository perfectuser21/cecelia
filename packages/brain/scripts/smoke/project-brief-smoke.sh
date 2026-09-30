#!/usr/bin/env bash
# project-brief-smoke — 接力棒链 2afa6d69 棒2 真库火：handoff.brief_delta → projects.brief（C 档直接生效 /
# A 档改 goal 或一次砍≥3 棒升 pending_actions）；派发链上下文带上改过的现状；PATCH /projects/:id/brief 已接线。
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
PROJ="$(q "INSERT INTO projects (name, description, status, brief) VALUES ('smoke brief 项目 $TAG', '目标', 'active', '{}'::jsonb) RETURNING id")"
T2="$(q "INSERT INTO tasks (title, task_type, status, priority, project_id, sequence_no) VALUES ('smoke 第二棒 $TAG', 'dev', 'in_progress', 'P2', '$PROJ', 2) RETURNING id")"
T3="$(q "INSERT INTO tasks (title, task_type, status, priority, project_id, sequence_no) VALUES ('smoke 第三棒 $TAG', 'dev', 'queued', 'P2', '$PROJ', 3) RETURNING id")"
# 用 cleanup 函数而非内联 trap 字符串：trap 的字符串在触发时会被整体重新展开，
# 其中任何 $$（bash 的 PID 变量）都会被吃掉，"$$project_id$$" 这类占位符实测在真正触发时
# 展开不出合法 SQL（真实复现：清理语句静默失败，残留数据），函数体里的普通变量引用没有这个坑。
cleanup() {
  q "DELETE FROM pending_actions WHERE params->>'project_id' = '$PROJ'" >/dev/null 2>&1 || true
  q "DELETE FROM tasks WHERE id IN ('$T2','$T3')" >/dev/null 2>&1 || true
  q "DELETE FROM projects WHERE id = '$PROJ'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$NODE" --input-type=module -e "
import pg from 'pg';
import { relayOnComplete } from '$BRAIN_DIR/src/lib/relay-baton.js';
import { saveHandoff, buildHandoff, getChainContext, formatChainForPrompt } from '$BRAIN_DIR/src/handoff.js';
import { applyProjectBriefDelta, applyApprovedBriefEscalation } from '$BRAIN_DIR/src/lib/project-brief-apply.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(\"UPDATE tasks SET status='completed', completed_at=NOW() WHERE id=\$1\", ['$T2']);
const h = buildHandoff({ task_id: '$T2', title: 'smoke 第二棒', verdict: 'PASS', done: ['x'], next_steps: ['完成，无下一步'],
  brief_delta: { status: 'smoke 现状已更新', add_facts: ['smoke 事实 A'] } });
await saveHandoff({ pool }, h);
const relay = await relayOnComplete(pool, '$T2');
if (!relay || !relay.brief || relay.brief.applied !== true) { console.error('brief_delta 未应用', relay); process.exit(1); }

const proj = await pool.query('SELECT brief FROM projects WHERE id=\$1', ['$PROJ']);
if (proj.rows[0].brief.status !== 'smoke 现状已更新') { console.error('brief.status 未落库', proj.rows[0].brief); process.exit(1); }

const ctx = await getChainContext({ pool }, '$T3');
if (ctx.root.kind !== 'project' || ctx.root.brief.status !== 'smoke 现状已更新') { console.error('链上下文未带最新 brief', ctx); process.exit(1); }
const prompt = formatChainForPrompt(ctx);
if (!prompt.includes('smoke 现状已更新') || !prompt.includes('smoke 事实 A')) { console.error('派发 prompt 未含最新现状/事实', prompt); process.exit(1); }

const esc = await applyProjectBriefDelta(pool, { projectId: '$PROJ', rawDelta: { goal: 'smoke 新目标' }, taskId: '$T2' });
if (!esc || esc.escalated !== true || !esc.pending_action_id) { console.error('改 goal 未升 A 档', esc); process.exit(1); }
const proj2 = await pool.query('SELECT brief FROM projects WHERE id=\$1', ['$PROJ']);
if (proj2.rows[0].brief.goal) { console.error('A 档未拍板前 goal 不该生效', proj2.rows[0].brief); process.exit(1); }
const pa = await pool.query('SELECT action_type, status FROM pending_actions WHERE id=\$1', [esc.pending_action_id]);
if (pa.rows[0].action_type !== 'project_brief_decision' || pa.rows[0].status !== 'pending_approval') { console.error('pending_action 形状不对', pa.rows[0]); process.exit(1); }

const approved = await applyApprovedBriefEscalation(pool, { projectId: '$PROJ', escalated: { goal: 'smoke 新目标' }, taskId: '$T2' });
if (approved.brief.goal !== 'smoke 新目标') { console.error('批准后 goal 未生效', approved); process.exit(1); }

await pool.end();
" || fail "brief_delta 全链失败"
pass "handoff.brief_delta → projects.brief 落库；第三棒链上下文/派发 prompt 带最新现状；改 goal 升 A 档 pending_actions，批准后才生效"

grep -q "brief_delta" "$REPO_DIR/hooks/stop.sh" || fail "stop.sh 接力棒闸提示未带 brief_delta 示例"
bash -n "$REPO_DIR/hooks/stop.sh" || fail "stop.sh 语法错"
pass "stop.sh 接力棒闸提示含 brief_delta 示例"

grep -q "router.patch('/:id/brief'" "$BRAIN_DIR/src/routes/task-projects.js" || fail "PATCH /projects/:id/brief 未接线"
pass "PATCH /api/brain/projects/:id/brief 已接线"

echo "ALL PASS: project-brief"
