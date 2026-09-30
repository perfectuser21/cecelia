#!/usr/bin/env bash
# packages/brain/scripts/smoke/workflow-run-lost-deadline-smoke.sh
# Smoke: 整批总时限到期判 lost + 收割器放锁回桌面（任务 c2d73868，决策 3c98fb36）
#   1. proven-to-fire（进程内假库 + 桩 ssh）：5h 前起跑的 device_job 镜像单 → failed(lost_deadline)，
#      三条善后命令（lock-release <TAG> / return-safe-desktop / openclaw cron rm <escort>）被调；新鲜行不动
#   2. 有库（DATABASE_URL/PG*）时：真表事务内插一条 5h 前的镜像单跑 job，读回 status/result.reason，ROLLBACK 不留痕
#   3. JOBS 注册：workflow-run-lost-deadline 在 scheduler-liveness 之前（liveness 自动把它入 ops_workflows）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[wf-lost-smoke] 1. 假库 proven-to-fire"
node --input-type=module -e "
import { runWorkflowRunLostDeadline, LOST_REASON } from './src/workflow-run-lost-deadline.js';
const stale = { id: 'smoke-lost', title: '获客采收 · 4137', task_type: 'device_job',
  payload: { serial: 'ANGYVB4402004137', source: 'cron', escort_id: 'esc-smoke-1' } };
const calls = []; const ssh = [];
const pool = { query: async (sql, params) => {
  calls.push({ sql: String(sql), params });
  if (/FROM tasks/.test(sql) && /in_progress/.test(sql)) return { rows: [stale] };
  if (/FROM task_runs/.test(sql)) return { rows: [{ run_id: 'social-keyword-leadgen-crontab-cmd09300200__a1.collection', ended_at: null }] };
  if (/FROM phone_registry/.test(sql)) return { rows: [{ host: 'xian-m4', profile: 'legacy' }] };
  if (/UPDATE tasks/.test(sql)) return { rows: [{ id: params[0], status: 'failed' }], rowCount: 1 };
  return { rows: [] };
} };
const execFileFn = (cmd, args, opts, cb) => { ssh.push(args[args.length - 1]); cb(null, 'ok', ''); };
const out = await runWorkflowRunLostDeadline(pool, { execFileFn, gateMs: 0 });
let bad = 0;
const want = (ok, msg) => { if (ok) console.log('PASS', msg); else { console.error('FAIL', msg); bad += 1; } };
want(out.lost === 1, 'lost=1');
const upd = calls.find((c) => /UPDATE tasks/.test(c.sql) && c.params[0] === 'smoke-lost');
want(upd && upd.sql.includes(\"status = 'failed'\") && upd.params.join('\\n').includes('\"reason\":\"' + LOST_REASON + '\"'), 'failed + result.reason=lost_deadline');
want(ssh.some((r) => r.includes('lock-release cmd09300200')), 'ssh lock-release <TAG>');
want(ssh.some((r) => r.includes('return-safe-desktop')), 'ssh return-safe-desktop');
want(ssh.some((r) => r.includes('openclaw cron rm esc-smoke-1')), 'ssh openclaw cron rm <escort>');
want(calls.some((c) => /INSERT INTO task_events/.test(c.sql) && c.params[1] === LOST_REASON), 'task_events lost_deadline');
want(calls.some((c) => /UPDATE task_runs/.test(c.sql) && c.params[1] === 'timeout'), 'task_runs timeout');
// 新鲜行：SQL 查不出 → 零动作
const ssh2 = []; const calls2 = [];
const pool2 = { query: async (sql, params) => { calls2.push(String(sql)); return { rows: [] }; } };
await runWorkflowRunLostDeadline(pool2, { execFileFn: (c, a, o, cb) => { ssh2.push(1); cb(null, '', ''); }, gateMs: 0 });
want(ssh2.length === 0 && !calls2.some((s) => /UPDATE/.test(s)), '未到期零 UPDATE 零 ssh');
process.exit(bad ? 1 : 0);
"

if command -v psql >/dev/null 2>&1 && { [ -n "${DATABASE_URL:-}" ] || [ -n "${PGDATABASE:-}" ]; }; then
  echo "[wf-lost-smoke] 2. 真库事务内到期判定"
  node --input-type=module -e "
import pg from 'pg';
import { runWorkflowRunLostDeadline, LOST_REASON } from './src/workflow-run-lost-deadline.js';
const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    \"INSERT INTO tasks (title, task_type, status, priority, payload, due_at, created_at) VALUES (\$1, 'device_job', 'in_progress', 'P2', '{\\\"serial\\\":\\\"SMOKE\\\",\\\"source\\\":\\\"cron\\\"}'::jsonb, NOW() - interval '5 hours', NOW()) RETURNING id\",
    ['wf-lost-smoke-' + Date.now()]);
  const id = rows[0].id;
  const out = await runWorkflowRunLostDeadline(client, { execFileFn: (c, a, o, cb) => cb(null, '', ''), gateMs: 0 });
  const r = await client.query(\"SELECT status, result->>'reason' AS reason FROM tasks WHERE id = \$1\", [id]);
  if (out.lost < 1 || r.rows[0].status !== 'failed' || r.rows[0].reason !== LOST_REASON) { console.error('FAIL 真库', out, r.rows[0]); process.exit(1); }
  console.log('PASS 真库 5h 前镜像单 → failed(lost_deadline)');
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
"
fi

echo "[wf-lost-smoke] 3. JOBS 注册"
node --input-type=module -e "
import { JOBS } from './src/scheduler-jobs.js';
const names = JOBS.map((j) => j.name);
const i = names.indexOf('workflow-run-lost-deadline'), l = names.indexOf('scheduler-liveness');
if (i < 0 || l < 0 || i > l) { console.error('FAIL JOBS 未注册或顺序错', i, l); process.exit(1); }
console.log('PASS workflow-run-lost-deadline 在 JOBS[' + i + ']，scheduler-liveness 在 [' + l + ']');
"
echo "[wf-lost-smoke] ✅ 全部通过"
