#!/usr/bin/env bash
# factory-commander-route-smoke — 工厂执行单改走 Brain→Commander→外壳→Codex（任务 c0fe7e30，决策 2186700a / 26df670a）真库真代码火：
# brain_config 开关 factory_commander_route_enabled 默认关、置 true 才开 → 推进器建单形状为 workflow_dispatch（真 tasks 约束放行）
# → 派发器调度单带 --run-id/--task-id 经 stdin 交（假）ssh → 收割读（假）外壳 delivery.json 分隔块进 result.delivery、
# 陪跑 skill 版本进 result 与 task_runs → 自动裁判按合同活动读回逐活动判证据（真 tasks 读写）。
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
import { dispatchWorkflowCommanderTasks, reapWorkflowCommanderRuns, DELIVERY_BEGIN, DELIVERY_END } from './src/lib/workflow-commander-dispatch.js';
import { isFactoryCommanderRouteEnabled } from './src/lib/factory-cycle.js';
import { buildExecSpec } from './src/lib/factory-pusher.js';
import { judgeTask, makeJudgeStore } from './src/lib/factory-judge.js';
import { resolveWorkflowConfig } from './src/lib/factory-workflow-config.js';
import { acquireDeviceLock, releaseDeviceLocksHeldBy } from './src/device-lock-helpers.js';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`DELETE FROM brain_config WHERE key = 'factory_commander_route_enabled'`);
  if (await isFactoryCommanderRouteEnabled(client)) die('开关默认应关');
  await client.query(`INSERT INTO brain_config (key, value) VALUES ('factory_commander_route_enabled', 'true')`);
  if (!(await isFactoryCommanderRouteEnabled(client))) die('brain_config 置 true 后开关应开');
  ok('brain_config factory_commander_route_enabled：默认关，置 true 才开');

  const cfg = resolveWorkflowConfig('douyin_video_publish.android');
  const ledger = { id: '1b5a0be0-f0b2-4960-af44-f09790a039c1', workflow_key: 'douyin_video_publish.android', workflow_name: '抖音 · 视频发布（安卓真机）', stage: 3, validation_mode: 'use_while_validate', window_k: 3, recent_pass: 0, recent_total: 0, candidate_version: 'android-douyin-private-video@1.0.8' };
  const spec = buildExecSpec({ ledger, cfg, stage: 3, skill: ledger.candidate_version, round: 1, commanderRoute: true });
  if (spec.task_type !== 'workflow_dispatch' || spec.payload.workflow_key !== 'douyin_video_publish.android') die(`开关开时建单形状不对: ${spec.task_type}`);
  const serial = cfg.device.serial;
  await client.query(`INSERT INTO device_locks (device_name) VALUES ($1) ON CONFLICT (device_name) DO NOTHING`, [serial]);
  await client.query(`UPDATE device_locks SET locked_by = NULL, locked_at = NULL, expires_at = NULL WHERE device_name = $1`, [serial]);
  const taskId = (await client.query(
    `INSERT INTO tasks (title, description, task_type, status, priority, payload) VALUES ($1, $2, $3, 'queued', 'P1', $4::jsonb) RETURNING id`,
    [spec.title, spec.description, spec.task_type, JSON.stringify(spec.payload)])).rows[0].id;
  ok('推进器 Commander 路径建单：workflow_dispatch 带 workflow_key 与工厂字段，真 tasks 约束放行');

  const sent = [];
  const deps = {
    now: () => new Date('2026-10-12T02:00:00Z'),
    target: 'smoke@127.0.0.1',
    lockGate: async (t) => {
      const r = await acquireDeviceLock(t.id, t.payload.device_serial, t.payload.device_ttl_minutes, client);
      return r.result === 'acquired' ? { pass: true, acquired: true } : { pass: false, status: r.result === 'unknown_device' ? 422 : 409, body: r };
    },
    releaseLock: (id) => releaseDeviceLocksHeldBy(id, client),
    sshDispatch: async (args, input) => { sent.push(input); return 'DISPATCHED'; },
  };
  const d = await dispatchWorkflowCommanderTasks(client, deps);
  const row = (await client.query('SELECT status, payload FROM tasks WHERE id = $1', [taskId])).rows[0];
  const runId = row.payload.run_id;
  if (d.dispatched !== 1 || row.status !== 'in_progress') die(`没派出去: ${JSON.stringify(d)}`);
  if (!row.payload.commander_order.includes(`--run-id ${runId} --task-id ${taskId}`) || !sent[0].includes(`--run-id ${runId}`)) die('调度单未带 run/task');
  ok('派发：调度单带 --run-id/--task-id 经 stdin 交 work-commander');

  const acts = ['preflight', 'prepare', 'publish', 'verify', 'cleanup'].map((k) => ({
    key: k, by: ['preflight', 'cleanup'].includes(k) ? 'shell' : 'agent',
    readback: { type: 'evidence', glob: `*${k}*original.json`, expect: { op: '>=', value: 1 } }, evidence_files: [`${runId}-${k}-original.json`],
  }));
  const delivery = {
    run_id: runId, claimed_result: 'success', lock_released: true, fail_reason: null, side_effects: [{ action: 'publish', reversible: false }],
    readback: { publish_attempts: 1, lock_status: 'free' }, final_evidence: [`${runId}-outward-ledger`], activities: acts,
    commander_skill: { name: 'wf-douyin_video_publish', version: '0.1.0' },
  };
  const r = await reapWorkflowCommanderRuns(client, {
    target: 'smoke@127.0.0.1', releaseLock: deps.releaseLock,
    sshProbe: async () => `EXIT=0\n${DELIVERY_BEGIN}\n${JSON.stringify(delivery)}\n${DELIVERY_END}\n{"finalAssistantVisibleText":"COMMANDER_RESULT {\\"status\\":\\"completed\\",\\"tag\\":\\"cmd-smoke\\"}"}`,
  });
  const done = (await client.query('SELECT id, task_type, title, status, payload, result FROM tasks WHERE id = $1', [taskId])).rows[0];
  if (r.completed !== 1 || done.result?.delivery?.run_id !== runId || done.result?.commander_skill?.version !== '0.1.0') die(`收割不对: ${JSON.stringify(done.result).slice(0, 300)}`);
  const tr = (await client.query('SELECT result FROM task_runs WHERE run_id = $1', [runId])).rows[0];
  if (tr?.result?.commander_skill?.name !== 'wf-douyin_video_publish') die(`task_runs 未记陪跑 skill: ${JSON.stringify(tr)}`);
  ok('收割：外壳 delivery.json → result.delivery，陪跑 skill 版本进 result 与 task_runs');

  const store = makeJudgeStore(client);
  const writes = [];
  const out = await judgeTask(done, {
    store: { ...store, findLedger: async () => ({ id: ledger.id, stage: 3, workflow_key: ledger.workflow_key }), writeJudge: async (id, j) => { writes.push(j); await store.writeJudge(id, j); } },
    resolveConfig: () => ({ ...cfg, visual_verify: false }), log: () => {}, createTask: async () => ({}), recordRun: async () => ({ duplicate: false }),
  });
  const names = writes[0].code.checks.filter((c) => c.name.startsWith('readback:')).map((c) => c.name);
  if (out.verdict !== 'pass' || names.length !== 5) die(`裁判不对: ${JSON.stringify({ out, names })}`);
  const judged = (await client.query(`SELECT result->'factory_judge'->>'verdict' AS v FROM tasks WHERE id = $1`, [taskId])).rows[0];
  if (judged.v !== 'pass') die('裁判结论未落 tasks.result.factory_judge');
  ok('自动裁判：合同 5 个活动读回逐条判证据，结论落 tasks.result.factory_judge');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
)
