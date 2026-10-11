#!/usr/bin/env bash
# workflow-commander-dispatch-smoke — Brain 主动派 workflow 给 work-commander（任务 f38e7cc2，决策 23cc0951 / 3c98fb36）真库真代码火：
# 真 tasks 表建 workflow_dispatch 单（迁移 549 约束放行）→ 派发器按真配置解析调度单、领真 device_locks 锁、
# 调度单经 stdin 交给（假）ssh、单子进 in_progress 且 payload 带 run_id → 第二张同手机单等锁不派 →
# 收割读（假）.exit + COMMANDER_RESULT → completed 带证据、锁释放；镜像判据不收 workflow_dispatch。
# 全程一个事务内跑，结束回滚；ssh 一律注入假传输，绝不碰真机。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(cd "$BRAIN_DIR" && "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { dispatchWorkflowCommanderTasks, reapWorkflowCommanderRuns, WORKFLOW_DISPATCH_TASK_TYPE } from './src/lib/workflow-commander-dispatch.js';
import { acquireDeviceLock, releaseDeviceLocksHeldBy } from './src/device-lock-helpers.js';
import { EXTERNAL_RUN_MIRROR_TASK_TYPES } from './src/lib/external-mirror-liveness.js';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  const serial = 'ANGYVB4311010223';
  await client.query(`INSERT INTO device_locks (device_name) VALUES ($1) ON CONFLICT (device_name) DO NOTHING`, [serial]);
  await client.query(`UPDATE device_locks SET locked_by = NULL, locked_at = NULL, expires_at = NULL WHERE device_name = $1`, [serial]);
  const mk = async (title) => (await client.query(
    `INSERT INTO tasks (title, description, task_type, status, priority, payload) VALUES ($1, '小彩 Ai办公室账号，仅私密', $2, 'queued', 'P1', $3::jsonb) RETURNING id`,
    [title, WORKFLOW_DISPATCH_TASK_TYPE, JSON.stringify({ workflow_key: 'douyin_video_publish.android' })])).rows[0].id;
  const t1 = await mk('wfd-smoke-1');
  ok(`迁移 549：tasks 接受 task_type=${WORKFLOW_DISPATCH_TASK_TYPE}`);

  const sent = [];
  const deps = {
    now: () => new Date('2026-10-12T02:00:00Z'), // 上海 10:00，发布时段内
    target: 'smoke@127.0.0.1',
    lockGate: async (t) => {
      const r = await acquireDeviceLock(t.id, t.payload.device_serial, t.payload.device_ttl_minutes, client);
      return r.result === 'acquired' ? { pass: true, acquired: true } : { pass: false, status: r.result === 'unknown_device' ? 422 : 409, body: r };
    },
    releaseLock: (id) => releaseDeviceLocksHeldBy(id, client),
    sshDispatch: async (args, input) => { sent.push({ remote: args[args.length - 1], input }); return 'DISPATCHED'; },
  };
  const d1 = await dispatchWorkflowCommanderTasks(client, deps);
  if (d1.dispatched !== 1) die(`第一张没派出去: ${JSON.stringify(d1)}`);
  const row1 = (await client.query('SELECT status, executor_kind, payload FROM tasks WHERE id = $1', [t1])).rows[0];
  if (row1.status !== 'in_progress' || row1.executor_kind !== 'openclaw-agent' || !/^wfd-/.test(row1.payload.run_id)) die(`派发后形状不对: ${JSON.stringify(row1)}`);
  if (!sent[0].remote.includes('--agent work-commander') || !sent[0].input.includes('调度单：douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室')) die('调度单没经 stdin 交给 work-commander');
  const lock = (await client.query('SELECT locked_by FROM device_locks WHERE device_name = $1', [serial])).rows[0];
  if (lock.locked_by !== String(t1)) die(`设备锁持有者不对: ${lock.locked_by}`);
  ok('认领 → 领锁 → ssh 起 work-commander（调度单走 stdin）→ in_progress，run_id 落 payload');

  const t2 = await mk('wfd-smoke-2');
  const d2 = await dispatchWorkflowCommanderTasks(client, deps);
  const row2 = (await client.query('SELECT status, claimed_by FROM tasks WHERE id = $1', [t2])).rows[0];
  if (d2.waiting !== 1 || row2.status !== 'queued' || row2.claimed_by !== null) die(`同手机第二张应等锁: ${JSON.stringify({ d2, row2 })}`);
  ok('同手机第二张：锁被占只等不接管，保持 queued 放 claim');

  const r1 = await reapWorkflowCommanderRuns(client, {
    target: 'smoke@127.0.0.1', releaseLock: deps.releaseLock,
    sshProbe: async () => 'EXIT=0\n{"finalAssistantVisibleText":"COMMANDER_RESULT {\\"status\\":\\"completed\\",\\"tag\\":\\"T-smoke\\",\\"evidence\\":[\\"T-smoke-outward-ledger\\"]}"}',
  });
  const done = (await client.query('SELECT status, result FROM tasks WHERE id = $1', [t1])).rows[0];
  if (r1.completed !== 1 || done.status !== 'completed' || !JSON.stringify(done.result).includes('T-smoke-outward-ledger')) die(`收割不对: ${JSON.stringify({ r1, done })}`);
  const lock2 = (await client.query('SELECT locked_by FROM device_locks WHERE device_name = $1', [serial])).rows[0];
  if (lock2.locked_by !== null) die(`收割后锁未释放: ${lock2.locked_by}`);
  ok('收割：COMMANDER_RESULT completed → completed 带证据，设备锁释放');

  if (EXTERNAL_RUN_MIRROR_TASK_TYPES.includes(WORKFLOW_DISPATCH_TASK_TYPE)) die('workflow_dispatch 混进外部镜像集合');
  ok('workflow_dispatch 不进外部 run 镜像集合（commander-watchdog / lost-deadline 不收）');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
)
