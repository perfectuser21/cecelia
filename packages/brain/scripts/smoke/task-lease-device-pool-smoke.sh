#!/usr/bin/env bash
# task-lease-device-pool-smoke — 统一领单租约 + 设备锁跟租约走 + 设备池（派发总闸 G，任务 c5f6e683）真库真代码火：
# 真 tasks / task_leases / device_locks / device_pools 表（迁移 553）上经真代码：
#   ① claim 带 lease_seconds → 落租约，返回 lease_until；心跳续约并把持有的设备锁 expires_at 拉到租约
#   ② 执行者「死了」（租约过期无心跳）→ task-lease-reaper 判 lost（openclaw-agent 外部执行体）并释放设备锁
#   ③ 设备池 douyin.internal 种子在、能从池里选到可用的一台并持锁
# 全程一个事务内跑，结束回滚；不碰真机、不连生产库。
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
import { claimTaskWithLease, heartbeatTaskLease, reapExpiredLeases } from './src/lib/task-lease.js';
import { acquireDeviceLock } from './src/device-lock-helpers.js';
import { listPoolCandidates, selectDeviceFromPool } from './src/lib/device-pool.js';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  const serial = 'LEASE-SMOKE-PHONE';
  await client.query(`INSERT INTO device_locks (device_name, device_type) VALUES ($1, 'phone') ON CONFLICT (device_name) DO NOTHING`, [serial]);
  const t = (await client.query(
    `INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('lease-smoke', 'skill_factory_run', 'queued', 'P2', '{}'::jsonb) RETURNING id`)).rows[0].id;

  const c = await claimTaskWithLease(client, { taskId: t, claimer: 'lease-smoke@ci', executorKind: 'openclaw-agent', leaseSeconds: 60 });
  if (c.status !== 200 || !c.body.lease_until) die(`claim 带租约失败: ${JSON.stringify(c)}`);
  await client.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [t]);
  if ((await acquireDeviceLock(t, serial, 1, client)).result !== 'acquired') die('领设备锁失败');
  const hb = await heartbeatTaskLease(client, { taskId: t, claimer: 'lease-smoke@ci', leaseSeconds: 600 });
  if (!hb.ok) die(`心跳失败: ${JSON.stringify(hb)}`);
  const lock = (await client.query('SELECT expires_at FROM device_locks WHERE device_name = $1', [serial])).rows[0];
  if (new Date(lock.expires_at).getTime() !== new Date(hb.lease.lease_until).getTime()) die('设备锁 expires_at 没跟租约走');
  ok('① claim 带租约 → 心跳续约，设备锁 expires_at 跟租约');

  await client.query(`UPDATE task_leases SET lease_until = NOW() - INTERVAL '1 minute' WHERE task_id = $1`, [t]);
  const out = await reapExpiredLeases(client, { probe: async () => 'unknown' });
  const row = (await client.query('SELECT status, error_message FROM tasks WHERE id = $1', [t])).rows[0];
  if (row.status !== 'failed' || !/^lease_expired/.test(row.error_message || '')) die(`过期租约没判 lost: ${JSON.stringify({ out, row })}`);
  const freed = (await client.query('SELECT locked_by FROM device_locks WHERE device_name = $1', [serial])).rows[0];
  if (freed.locked_by !== null) die('判 lost 后设备锁没释放');
  ok('② 执行者死了（租约过期无心跳）→ reaper 判 lost 并释放设备锁');

  const pool = await listPoolCandidates(client, 'douyin.internal');
  if (!pool.some((m) => m.serial === 'ANGYVB4311010223' && m.account_ref === 'Ai办公室')) die(`douyin.internal 池种子缺失: ${JSON.stringify(pool)}`);
  const t2 = (await client.query(
    `INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('lease-smoke-pool', 'workflow_dispatch', 'queued', 'P2', '{}'::jsonb) RETURNING id`)).rows[0].id;
  const gate = async (task) => {
    const r = await acquireDeviceLock(task.id, task.payload.device_serial, 30, client);
    return r.result === 'acquired' ? { pass: true } : { pass: false, status: r.result === 'unknown_device' ? 422 : 409, body: { error: r.result } };
  };
  const picked = await selectDeviceFromPool(client, 'douyin.internal', { id: t2, payload: {} }, { lockGate: gate });
  if (!picked.ok) die(`池里选机失败: ${JSON.stringify(picked)}`);
  ok(`③ 设备池 douyin.internal 选中 ${picked.member.serial}（${picked.member.account_ref}）并持锁`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
)
