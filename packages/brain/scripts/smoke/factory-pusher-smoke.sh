#!/usr/bin/env bash
# factory-pusher-smoke — 技能工厂推进器 + 自动裁判（任务 a5f42455 / 2231ecc0，决策 cc008b7e / 2bb08a99）真库真代码火：
# 台账 stage 3 → 推进器经真 createTask 建 factory_dispatch 执行单（派发器契约可解析）→ 在途不重复建单 →
# 模拟执行单交付 → 裁判建 run-verify 核验单 → 核验 pass 合并入窗 → 第二轮全过 → rule 推进到 4 并落事件；
# 同 run_id 重记去重；安全停止记 fail+safe_stop；开关关闭整轮跳过。全程一个事务内跑，结束回滚。
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
import { randomUUID } from 'node:crypto';
import { createTask } from './src/actions.js';
import { runFactoryCycle } from './src/lib/factory-cycle.js';
import { recordRun, getLedger } from './src/lib/factory-ledger.js';
import { resolveWorkflowConfig } from './src/lib/factory-workflow-config.js';
import { parseFactoryContract } from './scripts/factory-dispatcher/factory-dispatcher.js';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  const tag = `fp-smoke-${randomUUID().slice(0, 8)}`;
  const vs = randomUUID(), cap = randomUUID(), wf = randomUUID();
  await client.query('INSERT INTO value_streams (id, name) VALUES ($1, $2)', [vs, `${tag}-vs`]);
  await client.query("INSERT INTO capabilities (id, name, status, parent_journey_id) VALUES ($1, $2, 'active', $3)", [cap, `${tag}-cap`, vs]);
  await client.query("INSERT INTO workflows (id, capability_id, key, name, channel) VALUES ($1, $2, $3, $3, 'douyin')", [wf, cap, tag]);
  const ledgerId = (await client.query(
    `INSERT INTO factory_ledger (workflow_id, stage, window_k, candidate_version) VALUES ($1, 3, 2, 'android-douyin-private-video@1.0.8') RETURNING id`, [wf])).rows[0].id;

  const base = resolveWorkflowConfig('douyin_video_publish.android');
  const cfg = { ...base, workflow_key: tag, publish_hours: [0, 24] };
  const deps = {
    env: {}, force: true, now: () => new Date(), log: () => {}, raise: async () => {},
    resolveConfig: (key) => (key === tag ? cfg : null),
    createTask: (args) => createTask({ ...args, db: client }),
  };
  const cycle = () => runFactoryCycle(client, deps);
  const mine = (r) => r.push.find((x) => x.ledger_id === ledgerId);
  const task = async (id) => (await client.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
  const deliver = (id, delivery) => client.query(`UPDATE tasks SET status = 'completed', result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('delivery', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(delivery)]);
  const verifyPass = (id, runId) => client.query(`UPDATE tasks SET status = 'completed', result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('verification', $2::jsonb) WHERE id = $1`, [id, JSON.stringify({ stage: 'verify', run_id: runId, verdict: 'pass', assertions: [{ claim: 'x', result: 'pass' }] })]);
  const goodDelivery = (runId) => ({ run_id: runId, claimed_result: 'success', lock_released: true, fail_reason: null, side_effects: [{ action: '私密发布', reversible: false }], readback: { publish_attempts: 1, lock_status: 'free' }, final_evidence: [`${runId}-outward-ledger`] });

  // 1) 推进器建单
  const r1 = await cycle();
  const a1 = mine(r1)?.actions?.find((a) => a.type === 'dispatch');
  if (!a1?.task_id) die(`推进器没建执行单: ${JSON.stringify(mine(r1))}`);
  const t1 = await task(a1.task_id);
  // 派发总闸 F（任务 0a70684f）：执行单独立类型 skill_factory_run，tick 按类型排除，不再带 headed_manual
  if (t1.status !== 'queued' || t1.task_type !== 'skill_factory_run' || t1.payload.factory_dispatch !== true || t1.payload.headed_manual !== undefined) die(`执行单形状不对: ${JSON.stringify({ s: t1.status, t: t1.task_type, p: t1.payload })}`);
  const parsed = parseFactoryContract(t1);
  if (!parsed.ok || parsed.contract.stage !== '3' || parsed.contract.device.serial !== 'ANGYVB4311010223') die(`派发器解析不了: ${JSON.stringify(parsed)}`);
  if (!/--outward publish` 必须放在子命令及其参数（COMMAND）之后/.test(t1.description)) die('正文缺 --outward 位置纪律');
  ok(`推进器经真 createTask 建 stage 3 执行单（queued、task_type=skill_factory_run、派发器契约可解析）`);

  // 2) 在途不重复建单
  const r2 = await cycle();
  if (mine(r2).actions.length) die(`在途还在建单: ${JSON.stringify(mine(r2))}`);
  ok('同一台账行在途时不建第二张');

  // 3) 交付 → 裁判建核验单 → 核验 pass → 入窗，并建下一轮
  await deliver(t1.id, goodDelivery('sf3-run-1'));
  await cycle();
  const j1 = (await task(t1.id)).result.factory_judge;
  if (j1?.state !== 'awaiting_verify' || !j1.verify_task_id) die(`裁判没建核验单: ${JSON.stringify(j1)}`);
  const v1 = await task(j1.verify_task_id);
  const vp = parseFactoryContract(v1);
  if (!vp.ok || vp.contract.skill !== 'run-verify' || vp.contract.stage !== 'verify' || !v1.description.includes(t1.id)) die(`核验单不对: ${JSON.stringify(vp)}`);
  if (v1.task_type !== 'skill_factory_run') die(`核验单类型不对（应为 skill_factory_run）: ${v1.task_type}`);
  ok('代码裁判 pass → 自动建 run-verify 核验单（stage=verify，正文含被核验任务 id）');
  await verifyPass(v1.id, 'sf3-run-1');
  const r4 = await cycle();
  const j1b = (await task(t1.id)).result.factory_judge;
  if (j1b.state !== 'final' || j1b.verdict !== 'pass') die(`合并结论不对: ${JSON.stringify(j1b)}`);
  let g = await getLedger(client, ledgerId);
  if (g.ledger.recent_pass !== 1 || g.ledger.recent_total !== 1) die(`入窗不对: ${JSON.stringify(g.ledger)}`);
  const a2 = mine(r4).actions.find((a) => a.type === 'dispatch');
  if (!a2) die(`第二轮没建: ${JSON.stringify(mine(r4))}`);
  ok('核验 pass 与代码 pass 合并 → 台账滑窗 1/2，推进器建第 2 轮');

  // 4) 第二轮全过 → rule 推进到 4
  await deliver(a2.task_id, goodDelivery('sf3-run-2'));
  await cycle();
  await verifyPass((await task(a2.task_id)).result.factory_judge.verify_task_id, 'sf3-run-2');
  await cycle();
  g = await getLedger(client, ledgerId);
  const last = g.events.at(-1);
  if (g.ledger.stage !== 4 || last.actor !== 'rule' || last.from_stage !== 3 || last.to_stage !== 4) die(`没推进到 4: ${JSON.stringify({ l: g.ledger, e: last })}`);
  ok('滑窗 2/2 全过 → rule 推进 3→4，阶段事件留痕');

  // 5) 同 run_id 去重
  const d1 = await recordRun(client, ledgerId, { run_id: 'dup-run', pass: false, safe_stop: true });
  const d2 = await recordRun(client, ledgerId, { run_id: 'dup-run', pass: false, safe_stop: true });
  if (d1.duplicate || !d2.duplicate) die('同 run_id 去重失效');
  if (!d2.ledger.recent_runs.find((r) => r.run_id === 'dup-run')?.safe_stop) die('safe_stop 没写进滑窗');
  ok('同 run_id 只计一次；safe_stop 写进滑窗');

  // 6) 开关
  await client.query("INSERT INTO brain_config (key, value) VALUES ('factory_pusher_enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'");
  const off = await cycle();
  if (off.skipped !== 'disabled') die(`开关没生效: ${JSON.stringify(off)}`);
  ok('brain_config factory_pusher_enabled=false → 整轮跳过');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
) || fail "真函数段失败"
echo "factory-pusher-smoke: all passed"
