#!/usr/bin/env bash
# packages/brain/scripts/smoke/commander-watchdog-smoke.sh
# Smoke: Commander 看门狗 + 心跳 + Bark 阈值（任务 17ea4536，决策 3c98fb36）proven-to-fire
#   1. 假库 + 桩 ssh/Bark：把心跳伪造成 20 分钟前 → 断言 ssh 网关 `openclaw cron rm 旧 + cron add 同名 escort`
#      被调、新 id 回写、task_events commander_relaunched；接班计数 2→3 → Bark 被调一次且落 commander_bark_at
#   2. 趋势：同 wf 两天零线索 + 一台 serial 24h 无 completed → 两条 Bark（假库，强制窗口）
#   3. JOBS 注册：commander-watchdog / workflow-trend-bark 在 scheduler-liveness 之前
#   4. 有 Brain（BRAIN_URL）时：POST /commander-heartbeat 非法 tag → 400；kind=launch 无在途单 → 202
set -euo pipefail

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi
cd "$(dirname "$0")/../.."

echo "[cmdr-smoke] 1. 看门狗 proven-to-fire（心跳伪造过期）"
node --input-type=module -e "
import { runCommanderWatchdog } from './src/commander-watchdog.js';
const mk = (extra) => ({ id: 'smoke-run', task_type: 'device_job', title: '获客采收 · 4137',
  payload: { serial: 'ANGYVB4402004137', source: 'cron', tag: 'cmd09300200', host: 'xian-m4', profile: 'legacy', escort_id: 'esc-old', commander_heartbeat_at: new Date(Date.now() - 20 * 60e3).toISOString(), ...extra } });
let bad = 0; const want = (ok, msg) => { if (ok) console.log('PASS', msg); else { console.error('FAIL', msg); bad += 1; } };
async function round(extra) {
  const calls = []; const ssh = [];
  const pool = { query: async (sql, params) => { calls.push({ sql: String(sql), params });
    if (/FROM tasks/.test(sql) && /commander_heartbeat_at/.test(sql)) return { rows: [mk(extra)] };
    if (/UPDATE tasks/.test(sql)) return { rows: [{ id: params[0] }], rowCount: 1 };
    return { rows: [] }; } };
  const barks = [];
  const out = await runCommanderWatchdog(pool, {
    execFileFn: (c, a, o, cb) => { ssh.push(a[a.length - 1]); cb(null, '{\"id\": \"esc-new-9\"}', ''); },
    bark: async (t, b) => { barks.push(t + ' ' + b); return true; }, gateMs: 0 });
  return { out, calls, ssh, barks };
}
const r1 = await round({});
want(r1.out.relaunched === 1, '心跳过期 → relaunched=1');
want(r1.ssh.some((s) => s.includes('cron rm esc-old')), 'ssh: openclaw cron rm 旧 escort');
want(r1.ssh.some((s) => s.includes(\"cron add --timeout 90000 --name 'escort-xian-m4-cmd09300200'\") && s.includes('接班')), 'ssh: cron add 同名 escort（接班消息）');
const upd = r1.calls.find((c) => /UPDATE tasks/.test(c.sql));
want(JSON.parse(upd.params[1]).escort_id === 'esc-new-9' && JSON.parse(upd.params[1]).commander_relaunch_count === 1, '新 escort id + 计数回写 payload');
want(r1.calls.some((c) => /INSERT INTO task_events/.test(c.sql) && c.params[1] === 'commander_relaunched'), 'task_events commander_relaunched');
want(r1.barks.length === 0, '首次接班不 Bark');
const r3 = await round({ commander_relaunch_count: 2 });
want(r3.out.barked === 1 && r3.barks.length === 1 && /cmd09300200/.test(r3.barks[0]), '第 3 次接班 → Bark 一次');
want(JSON.parse(r3.calls.find((c) => /UPDATE tasks/.test(c.sql)).params[1]).commander_bark_at, 'commander_bark_at 落下（停拉）');
process.exit(bad ? 1 : 0);
"

echo "[cmdr-smoke] 2. 趋势 Bark"
node --input-type=module -e "
import { runWorkflowTrendBark } from './src/commander-watchdog.js';
const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const d = (n) => { const x = new Date(day + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
const pool = { query: async (sql) => {
  if (/Asia\\/Shanghai/.test(sql)) return { rows: [ { label: 'zero-wf', day: d(1), runs: '2', leads: '0' }, { label: 'zero-wf', day: d(2), runs: '1', leads: '0' }, { label: 'ok-wf', day: d(1), runs: '1', leads: '5' }, { label: 'ok-wf', day: d(2), runs: '1', leads: '0' } ] };
  if (/FROM phone_registry/.test(sql)) return { rows: [ { serial: 'S1', nickname: '小黄', recent_runs: '3', last_ok: null }, { serial: 'S2', nickname: '小闲', recent_runs: '0', last_ok: null } ] };
  return { rows: [] }; } };
const barks = [];
const out = await runWorkflowTrendBark(pool, { bark: async (t, b) => { barks.push(b); return true; }, windowOverride: true });
let bad = 0; const want = (ok, msg) => { if (ok) console.log('PASS', msg); else { console.error('FAIL', msg); bad += 1; } };
want(JSON.stringify(out.zeroLeads) === '[\"zero-wf\"]', '连续两天零线索只点 zero-wf');
want(JSON.stringify(out.staleSerials) === '[\"S1\"]' && barks.some((b) => b.includes('小黄')) && !barks.some((b) => b.includes('小闲')), '24h 无 completed 点名小黄，闲置不叫');
want(barks.length === 2, '两条 Bark');
process.exit(bad ? 1 : 0);
"

echo "[cmdr-smoke] 3. JOBS 注册"
node --input-type=module -e "
import { JOBS } from './src/scheduler-jobs.js';
const names = JOBS.map((j) => j.name); const l = names.indexOf('scheduler-liveness');
for (const n of ['commander-watchdog', 'workflow-trend-bark']) { const i = names.indexOf(n); if (i < 0 || i > l) { console.error('FAIL JOBS', n, i, l); process.exit(1); } console.log('PASS', n, 'JOBS[' + i + '] < liveness[' + l + ']'); }
"

if [ -n "${BRAIN_URL:-}" ] && curl -sf -m 5 "$BRAIN_URL/api/brain/tick/status" >/dev/null 2>&1; then
  echo "[cmdr-smoke] 4. Brain 心跳入口"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' -d '{"tag":"bad tag"}' "$BRAIN_URL/api/brain/commander-heartbeat")
  [ "$CODE" = "400" ] || { echo "FAIL 非法 tag 返回 $CODE"; exit 1; }; echo "非法 tag → 400 ✓"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' -d '{"kind":"launch","tag":"smoke0000000000","host":"xian-m4","escort_id":"smoke-esc"}' "$BRAIN_URL/api/brain/commander-heartbeat")
  [ "$CODE" = "202" ] || { echo "FAIL launch 登记返回 $CODE"; exit 1; }; echo "kind=launch 无在途单 → 202 ✓"
fi
echo "[cmdr-smoke] ✅ 全部通过"
