#!/usr/bin/env bash
# bypass-audit-smoke — 旁路报警（派发总闸 H，任务 865b502c）真库真代码火：
# 真 tasks 表建一张带 Brain run_id 的单 → 该 run 领锁/对外推送不记旁路（正常派发不误报）→
# 无任务号持有者领锁记 phone_lock 旁路、同持有者心跳续租不重复记 → 当天汇总写 runs bypass-audit:<日期> outcome=fail →
# 运维视图按天×类别聚合查得到。全程一个事务内跑，结束回滚；Bark 注入假函数，不碰真机、不发通知。
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
import { recordBypassAction, noteDeviceLockAcquire, runBypassDailyRollup, summarizeBypass, shanghaiDay, BYPASS_EVENT_TYPE } from './src/bypass-audit.js';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  const before = (await client.query('SELECT count(*)::int AS n FROM cecelia_events WHERE event_type = $1', [BYPASS_EVENT_TYPE])).rows[0].n;
  const t = (await client.query(
    `INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('bypass-smoke', 'dev', 'in_progress', 'P2', '{}'::jsonb) RETURNING id`)).rows[0].id;
  const runId = `qiumi-${String(t).slice(0, 8)}-${Date.now()}`;
  await client.query(`UPDATE tasks SET payload = jsonb_build_object('run_id', $2::text) WHERE id = $1`, [t, runId]);

  const a = await noteDeviceLockAcquire(client, { device: 'SMOKE-SERIAL', owner: String(t) });
  const b = await recordBypassAction(client, { kind: 'phone_outward', owner: `${runId}:a1`, device: 'SMOKE-SERIAL', action: 'publish' });
  const c = await recordBypassAction(client, { kind: 'openclaw_push', owner: `agent:media:${runId}`, run_id: runId, dedupe_key: 'openclaw:smoke-linked' });
  if (a.bypass || b.bypass || c.bypass) die(`Brain 派发的 run 被误报: ${JSON.stringify({ a, b, c })}`);
  ok('Brain 任务 uuid 持有者 / run_id:aN / OpenClaw 会话 agent:<dept>:<run_id> 均判为已关联，不记旁路');

  const owner = 'outreach-tick:xian-m4:20261012T010000:4242';
  const d = await noteDeviceLockAcquire(client, { device: 'SMOKE-SERIAL', owner, host: 'xian-m4' });
  const e = await noteDeviceLockAcquire(client, { device: 'SMOKE-SERIAL', owner, host: 'xian-m4' });
  if (!d.recorded || !e.deduped) die(`无任务号领锁应记一次且续租去重: ${JSON.stringify({ d, e })}`);
  const ev = (await client.query('SELECT source, payload FROM cecelia_events WHERE id = $1', [d.event_id])).rows[0];
  if (ev.source !== 'phone_lock' || ev.payload.owner !== owner || ev.payload.device !== 'SMOKE-SERIAL') die(`旁路事件形状不对: ${JSON.stringify(ev)}`);
  const after = (await client.query('SELECT count(*)::int AS n FROM cecelia_events WHERE event_type = $1', [BYPASS_EVENT_TYPE])).rows[0].n;
  if (after - before !== 1) die(`应只新增 1 条旁路事件，实际 ${after - before}`);
  ok('无 Brain 任务号的领锁 → cecelia_events 记 phone_lock 旁路（owner/设备齐），心跳续租同持有者不重复');

  const barks = [];
  const now = Date.now();
  const r = await runBypassDailyRollup(client, { now: () => now, sendBark: async (...args) => { barks.push(args); return true; } });
  const day = shanghaiDay(now);
  const run = (await client.query('SELECT outcome, trigger_kind, detail FROM runs WHERE run_id = $1', [`bypass-audit:${day}`])).rows[0];
  if (!run || run.outcome !== 'fail' || run.trigger_kind !== 'schedule' || !(run.detail.counts.phone_lock >= 1)) die(`当天汇总行不对: ${JSON.stringify({ r, run })}`);
  if (barks.some(([, , o]) => o.dedupeKey.endsWith(':phone_lock'))) die('领锁（系统类）不该 Bark');
  ok(`runs 写 bypass-audit:${day} outcome=fail（counts.phone_lock=${run.detail.counts.phone_lock}），领锁类不推主理人`);

  const s = await summarizeBypass(client, { days: 2 });
  if (!s.rows.some((x) => x.day === day && x.kind === 'phone_lock' && x.n >= 1)) die(`运维视图没聚合到当天领锁旁路: ${JSON.stringify(s.rows)}`);
  ok('运维视图按上海日 × 类别聚合到当天 phone_lock 旁路');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
)
