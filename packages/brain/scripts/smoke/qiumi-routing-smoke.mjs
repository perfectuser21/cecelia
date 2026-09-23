/**
 * 秋米路由判定真库 smoke（PR3-甲）：真 Postgres（cecelia_test）+ 假 Jev（fetchFn）。
 * 三闸——全部只碰「判定」这一层（routing/*），不碰 dispatcher、不碰 ssh、不碰 Notion：
 *  1 agent 分支：正文写明「用 Claude Code」→ 便宜闸硬约束压过 Jev 给的 codex，
 *    payload.model=anthropic/claude-sonnet-5、run_id 合规、task_events 有 qiumi_route_decided
 *  2 device 分支（走**真实回执路径**：createRoutedTask 建父任务）：正文含注册表内序列号 →
 *    一次 Jev 都不问（便宜闸在 Jev 前，铁律 6eb0dff5）→ 派生 device_job 子任务
 *    （assigned_to=phone-SMOKE1 / payload.serial / parent_task_id）、父任务挂
 *    blocked+delegated_device_job+payload.device_task_id、claim 已释放；
 *    子任务置 completed 后跑 reconcileDelegatedDeviceJobs → 父任务 completed_no_pr +
 *    result.receipt.device_task_id 对上。
 *    **这一闸就是补充五的证据闸**：改成派生子任务之前，persistDecision 在这条路上必抛
 *    `work_routing_task_projection_immutable`（迁移 421 的回执不可变触发器）。
 *  3 fail-closed：is_device 落在阈值中间（noul=0.5）→ 不派，status=failed、error_message 以 device_uncertain 开头
 *
 * 收割（.exit → completed_no_pr）与中文表推送收窄那两闸不在本刀的面上——它们要 import
 * openclaw-agent-executor.js / notion-gtd-sync.js，都是 PR3-乙 才落地的文件。见
 * `qiumi-dispatch-smoke.sh`。
 *
 * 闸 3 的变异点写成文件顶部两个常量（GATE3_NOUL / GATE3_ACCOUNT）：把 0.5 改 0.95 且 account 给 SMOKE1，
 * 闸 3 必红——那说明 fail-closed 那道闸是真在挡，不是顺带通过。
 *
 * 一个「为什么这么搭」：闸 1/3 的任务直插，只有闸 2 走 createRoutedTask——路由账房会写
 * work_routing_receipts，那张表 append-only 且外键指着 tasks，走它建的行删不掉。但闸 2 要验的
 * 恰恰是「有回执时设备分支还成不成立」，不走真路径就验不到（Task 6 的旧闸 2 正是这么漏掉那条
 * Critical 的）。代价：闸 2 每跑一次在测试库留两行（父+子），清理时改名 `[smoke-residue] ` + 置 archived。
 *
 * 只删自己插的行（固定 title 前缀 + 固定序列号），绝不动别人的行。
 */
import pg from 'pg';
import { qiumiEnv } from '../../src/routing/env.js';
import { routeQiumiTask, persistDecision } from '../../src/routing/qiumi-router.js';
import { reconcileDelegatedDeviceJobs } from '../../src/routing/device-delegation.js';
import { createRoutedTask } from '../../src/work-routing-store.js';
import { buildQiumiSource } from '../../src/lib/qiumi-source.js';

// 闸 3 的变异点：0.5 → 0.95 且 account 改 'SMOKE1'，闸 3 必须由绿转红。
const GATE3_NOUL = 0.5;
const GATE3_ACCOUNT = 'not_applicable';

// decideWithFallback 只在有 key 时才走 jev 分支；没有 key 会直接降级去问 terra（真打 LLM）。
process.env.JEV_API_KEY ||= 'smoke-stub';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const env = qiumiEnv();
const T = `[smoke] qiumi-routing ${process.pid}`;
const SERIAL = 'SMOKE1';

let passed = 0;
let failed = 0;
const pass = (gate, what) => { passed++; console.log(`  PASS 闸${gate} ${what}`); };
const bad = (gate, what) => { failed++; console.error(`  FAIL 闸${gate} ${what}`); };
const check = (gate, cond, what) => (cond ? pass(gate, what) : bad(gate, what));

let jevCalls = 0;
/** 假 Jev：原样吐 TypeSafe /v1/systemone 的响应形状（choice 型与 noul 型字段不同，勿统一）。 */
const jevStub = (answers) => async () => {
  jevCalls++;
  return { ok: true, json: async () => ({ answers }) };
};
/**
 * terra 兜底封死：Jev stub 一旦形状写错、答案被判无效，decideWithFallback 会静默降级去问 terra，
 * 那是真打 LLM——网络慢一点 smoke 就变成随机红，更糟的是它可能歪打正着地绿。
 * 这里塞一个必抛的 callLLMFn，降级立刻现形。
 */
const noTerra = () => { throw new Error('smoke 不许降级到 terra（真打 LLM）'); };
const choice = (c, probs, confidence = 0.3) => ({ type: 'choice', choice: c, confidence, probabilities: probs });
const noul = (p) => ({ type: 'noul', noul: p });

async function insertTask(suffix, qiumiSource, extraPayload = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, trigger_source, executor_kind, payload)
     VALUES ($1, 'qiumi_task', 'queued', 'P2', 'manual', 'openclaw-agent', $2::jsonb)
     RETURNING id, payload`,
    [`${T} ${suffix}`, JSON.stringify({ qiumi_source: qiumiSource, ...extraPayload })],
  );
  return rows[0];
}

const taskRow = async (id) => (await pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const eventTypes = async (id) => (await pool.query(
  'SELECT event_type FROM task_events WHERE task_id = $1', [id],
)).rows.map((r) => r.event_type);

/**
 * 只动自己插的行（固定 title 前缀带 pid + 固定序列号）。
 * 带路由回执的行（闸 2 的父+子）删不掉：work_routing_receipts 是 append-only，
 * 还有外键顶着 tasks —— 这类行改名 `[smoke-residue] ` 并置 archived，其余照删。
 */
async function cleanup() {
  const { rows } = await pool.query(
    'SELECT id FROM tasks WHERE title LIKE $1 OR title LIKE $2', [`${T}%`, `[smoke-residue] ${T}%`],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await pool.query('DELETE FROM task_events WHERE task_id = ANY($1::uuid[])', [ids]);
    await pool.query(
      `UPDATE tasks
          SET title = CASE WHEN title LIKE '[smoke-residue]%' THEN title ELSE '[smoke-residue] ' || title END,
              status = 'archived', updated_at = NOW()
        WHERE id = ANY($1::uuid[]) AND id IN (SELECT task_id FROM work_routing_receipts)`,
      [ids],
    );
    await pool.query(
      'DELETE FROM tasks WHERE id = ANY($1::uuid[]) AND id NOT IN (SELECT task_id FROM work_routing_receipts)',
      [ids],
    );
  }
  await pool.query('DELETE FROM device_locks WHERE device_name = $1', [SERIAL]);
}

async function main() {
  await cleanup();
  // 注册表真身：手机序列号在 device_locks，不在 ops_agents（计划补充三）。
  await pool.query(
    `INSERT INTO device_locks (device_name, host, device_type) VALUES ($1, 'smoke-host', 'phone')
     ON CONFLICT (device_name) DO NOTHING`,
    [SERIAL],
  );

  // ── 闸 1：agent 分支，便宜闸硬约束压过模型答案 ──
  {
    const t = await insertTask('闸1', {
      title: '用 Claude Code 改按钮文案',
      remark: '',
      body: '把中控页那个按钮的文案从「开始」改成「立即开始」。',
    });
    const before = jevCalls;
    const decision = await routeQiumiTask(t, {
      pool,
      env,
      callLLMFn: noTerra,
      fetchFn: jevStub({
        kind: choice('agent', { agent: 0.8, workflow: 0.2 }),
        is_device: noul(0.05),
        engine: choice('codex', { codex: 0.75, terra: 0.25 }),
        department: choice('dev', { dev: 0.7, main: 0.3 }),
        account: choice('not_applicable', { not_applicable: 0.95 }),
        workflow_ref: choice('not_applicable', { not_applicable: 0.95 }),
      }),
    });
    await persistDecision(pool, t, decision);
    const row = await taskRow(t.id);
    const events = await eventTypes(t.id);
    check(1, decision.outcome === 'agent', `outcome=agent（实得 ${decision.outcome}）`);
    check(1, jevCalls === before + 1, `问过一次 Jev（实得 ${jevCalls - before} 次）`);
    check(1, row.payload.model === 'anthropic/claude-sonnet-5',
      `便宜闸 claude 压过 Jev 的 codex，model=${row.payload.model}`);
    check(1, /^qiumi-[0-9a-f]{8}-\d{10,}$/.test(row.payload.run_id ?? ''), `run_id 合规=${row.payload.run_id}`);
    check(1, row.payload.qiumi_department === 'dev', `department=${row.payload.qiumi_department}`);
    check(1, events.includes('qiumi_route_decided'), `task_events 留痕=${events.join(',')}`);
  }

  // ── 闸 2：device 分支走真实回执路径 —— 便宜闸命中序列号直接定案 → 派生 device_job 子任务 ──
  // 父任务经 createRoutedTask 建（canonical_task_type='qiumi_task'，和生产入账同一条路），
  // 于是 tasks 上的 work_routing_task_projection_immutable 触发器在这一闸是**带电的**。
  {
    const body = `在 ${SERIAL} 这台机器上跑一轮日常。`;
    const routed = await createRoutedTask(pool, {
      source: 'child',
      source_id: `qiumi-routing-smoke:${process.pid}:${Date.now()}`,
      title: `${T} 闸2`,
      description: body,
      requested_task_type: 'qiumi_task',
      mutation_intent: 'none',
      declared_domain: 'operations',
      metadata: {
        source: 'notion_gtd',
        headed_manual: true,
        qiumi_source: buildQiumiSource({ title: '给账号跑一轮', remark: '', body, channel: null }),
      },
      task: { priority: 'P2', status: 'queued', trigger_source: 'manual', executor_kind: 'openclaw-agent' },
    });
    const t = routed.task;
    const canonical = (await pool.query(
      'SELECT canonical_task_type FROM work_routing_receipts WHERE task_id = $1', [t.id],
    )).rows[0]?.canonical_task_type;
    check(2, canonical === 'qiumi_task', `父任务真有回执且 canonical=${canonical}（触发器带电）`);

    const before = jevCalls;
    const decision = await routeQiumiTask(t, {
      pool,
      env,
      callLLMFn: noTerra,
      fetchFn: jevStub({ kind: choice('agent', { agent: 0.9 }), is_device: noul(0.01), engine: choice('terra', { terra: 0.9 }), department: choice('main', { main: 0.9 }), account: choice('not_applicable', {}), workflow_ref: choice('not_applicable', {}) }),
    });
    await persistDecision(pool, t, decision);
    const parent = await taskRow(t.id);
    const events = await eventTypes(t.id);
    check(2, jevCalls === before, `便宜闸在 Jev 前：一次都没问（实得 ${jevCalls - before} 次）`);
    check(2, parent.task_type === 'qiumi_task', `父任务类型没被改（实得 ${parent.task_type}）`);
    check(2, parent.status === 'blocked', `父任务 status=${parent.status}`);
    check(2, parent.blocked_reason === 'delegated_device_job', `父任务 blocked_reason=${parent.blocked_reason}`);
    check(2, parent.claimed_by === null, `claimed_by 已释放（实得 ${parent.claimed_by}）`);
    check(2, !!parent.payload.device_task_id, `父任务 payload.device_task_id=${parent.payload.device_task_id}`);
    check(2, parent.payload.routing_receipt_id != null, '回执键还在（触发器比对的那几个键没被动过）');

    const child = parent.payload.device_task_id ? await taskRow(parent.payload.device_task_id) : null;
    check(2, child?.task_type === 'device_job', `子任务 task_type=${child?.task_type}`);
    check(2, child?.assigned_to === `phone-${SERIAL}`, `子任务 assigned_to=${child?.assigned_to}`);
    check(2, child?.executor_kind === 'headed-session', `子任务 executor_kind=${child?.executor_kind}`);
    check(2, child?.payload?.serial === SERIAL, `子任务 payload.serial=${child?.payload?.serial}`);
    check(2, child?.payload?.parent_task_id === t.id, `子任务 payload.parent_task_id=${child?.payload?.parent_task_id}`);
    check(2, child?.payload?.headed_manual === true, `子任务 headed_manual=${child?.payload?.headed_manual}`);
    check(2, child?.payload?.notion_zh_page_id === undefined,
      `子任务不继承中文页 id（实得 ${child?.payload?.notion_zh_page_id}）——SQL 层那道 task_type 收窄由 qiumi-dispatch-smoke 验`);
    check(2, events.includes('qiumi_device_delegated'), `task_events 留痕=${events.join(',')}`);

    // 对账：子任务跑完 → 父任务销账
    await pool.query(
      `UPDATE tasks SET status='completed', completed_at=NOW(), result=$2::jsonb, updated_at=NOW() WHERE id=$1`,
      [child.id, JSON.stringify({ note: 'smoke 子任务完成' })],
    );
    const out = await reconcileDelegatedDeviceJobs(pool);
    const reconciled = await taskRow(t.id);
    check(2, out.completed >= 1, `对账计数 completed=${out.completed}`);
    check(2, reconciled.status === 'completed_no_pr', `对账后父任务 status=${reconciled.status}`);
    check(2, reconciled.result?.receipt?.device_task_id === child.id,
      `父任务 result.receipt.device_task_id=${reconciled.result?.receipt?.device_task_id}`);
  }

  // ── 闸 3：is_device 含糊 → fail-closed，绝不回落 agent 通道 ──
  {
    const t = await insertTask('闸3', {
      title: '整理一下上周的记录',
      remark: '',
      body: '把上周的记录按时间顺序归档到表里。',
    });
    const decision = await routeQiumiTask(t, {
      pool,
      env,
      callLLMFn: noTerra,
      fetchFn: jevStub({
        kind: choice('agent', { agent: 0.8, workflow: 0.2 }),
        is_device: noul(GATE3_NOUL),
        engine: choice('terra', { terra: 0.9 }),
        department: choice('main', { main: 0.9 }),
        account: choice(GATE3_ACCOUNT, { [GATE3_ACCOUNT]: 0.95 }),
        workflow_ref: choice('not_applicable', { not_applicable: 0.95 }),
      }),
    });
    await persistDecision(pool, t, decision);
    const row = await taskRow(t.id);
    check(3, decision.outcome === 'fail', `outcome=fail（实得 ${decision.outcome}）`);
    check(3, row.status === 'failed', `status=${row.status}`);
    check(3, String(row.error_message ?? '').startsWith('device_uncertain'),
      `error_message=${row.error_message}`);
    check(3, row.task_type === 'qiumi_task', `没被转成 device_job（实得 ${row.task_type}）`);
  }
}

try {
  await main();
} catch (err) {
  failed++;
  console.error(`FAIL 异常：${err.stack ?? err.message}`);
} finally {
  await cleanup().catch((e) => console.error(`清理失败：${e.message}`));
  await pool.end().catch(() => {});
}

console.log(failed === 0 ? `\nALL PASS（${passed} 项断言，3 闸全过）` : `\nFAILED：${failed} 项不通过 / ${passed} 项通过`);
process.exit(failed === 0 ? 0 : 1);
