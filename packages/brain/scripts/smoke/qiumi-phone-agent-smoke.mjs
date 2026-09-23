/**
 * 秋米手机活改走 OpenClaw agent 的真库 smoke：真 Postgres（cecelia_test）+ 假 Jev（fetchFn）+ 假 ssh（spawnFn）。
 *
 * 验的是本刀新开的那条缝：开关 `QIUMI_DEVICE_DELEGATION_ENABLED`（只认 'true'，默认关）。
 * 判定层旧三闸（agent 硬约束 / device 真回执 / ambiguous fail-closed）在 qiumi-routing-smoke，
 * 收割层三闸在 qiumi-dispatch-smoke，本刀都不重复。
 *
 *  1 默认关（不带开关）：正文含注册表内序列号的手机活 → outcome='agent'（不再改道西安领单器），
 *    payloadPatch.qiumi_route.device_hint 带上 serial/host；persistDecision 后查库：父任务
 *    **仍是 queued**（没被挂起）、device_hint 落进 payload、tasks 里没有指着它的 device_job 子任务。
 *    「没派生子任务」这条按 payload->>'parent_task_id' 反查，不靠 payload.device_task_id 缺失来推——
 *    子任务真被建出去而父任务挂起失败时，父任务上正好也没有 device_task_id（见 router 的 orphan 分支），
 *    只看父任务会把那种最糟的情况读成绿。
 *  2 开关开（QIUMI_DEVICE_DELEGATION_ENABLED='true'）：同样的活 → outcome='device'，
 *    一次 Jev 都不问（便宜闸在 Jev 前，铁律 6eb0dff5），persistDecision 后父任务
 *    status='blocked' + blocked_reason='delegated_device_job' + payload.device_task_id 指着子任务，
 *    子任务 task_type='device_job'、assigned_to='phone-<serial>'、payload.parent_task_id 指回父任务。
 *    = 开关开时行为与旧版一致，这条开关是可回滚的。
 *  3 prompt 段：拿闸 1 落库后的那条任务跑 triggerOpenclawAgent（注入假 child），
 *    断言灌进 ssh **stdin** 的正文含「设备提示」「序列号」「XIAN-M4-PHONE」「douyin-phone-adb」，
 *    且 spawnFn 的 argv 里**不含**序列号——正文只走 stdin（buildRemoteCommand 的 `M=$(cat)`），
 *    漏进命令行就等于把任务正文写进远端进程表与 shell 历史。
 *
 * 闸 2 的子任务走**注入的** createRoutedTaskFn（直插），不走真 createRoutedTask：真路径会往
 * append-only 的 work_routing_receipts 写行、外键顶着 tasks，跑一次就在测试库留两行删不掉的残渣。
 * 「有回执时设备分支还成不成立」那一条（不可变触发器带电）已由 qiumi-routing-smoke 闸 2 钉住，
 * 本闸要证的只是「开关开 → 还是派生 + 挂起」，所以选无残渣的那条路。
 * 为防注入把闸变成自说自话，另断言注入的建单函数确实被调用了一次。
 *
 * 变异验证（proven-to-fire，不留在文件里）：把闸 1 的期望 outcome 由 'agent' 改成 'device' 跑一次，
 * 本 smoke 必红——说明闸 1 咬的是真行为，不是顺带通过。
 *
 * 只删自己插的行（固定 title 前缀带 pid + 序列号 SMOKE-<pid>），绝不动别人的行。
 */
import pg from 'pg';
import { qiumiEnv } from '../../src/routing/env.js';
import { routeQiumiTask, persistDecision } from '../../src/routing/qiumi-router.js';
import { triggerOpenclawAgent } from '../../src/openclaw-agent-executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const T = `[smoke] qiumi-phone-agent ${process.pid}`;
const SERIAL = `SMOKE-${process.pid}`;
const HOST = 'xian-m4';
const NODE_NAME = 'XIAN-M4-PHONE'; // phoneNodeName 的派生规则：host 大写 + '-PHONE'

let passed = 0;
let failed = 0;
const pass = (gate, what) => { passed++; console.log(`  PASS 闸${gate} ${what}`); };
const bad = (gate, what) => { failed++; console.error(`  FAIL 闸${gate} ${what}`); };
const check = (gate, cond, what) => (cond ? pass(gate, what) : bad(gate, what));

let jevCalls = 0;
/** 假 Jev：原样吐 TypeSafe /v1/systemone 的响应形状（choice 型与 noul 型字段不同，勿统一）。 */
const jevStub = (answers) => async () => {
  jevCalls++;
  return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers }) };
};
/**
 * terra 兜底封死：Jev stub 一旦形状写错、答案被判无效，decideWithFallback 会静默降级去问 terra，
 * 那是真打 LLM——网络慢一点 smoke 就变成随机红，更糟的是它可能歪打正着地绿。
 */
const noTerra = () => { throw new Error('smoke 不许降级到 terra（真打 LLM）'); };
const choice = (c, probs, confidence = 0.3) => ({ type: 'choice', choice: c, confidence, probabilities: probs });
const noul = (p) => ({ type: 'noul', noul: p });

/** 手机活的 qiumi_source：正文里写死本 smoke 自己插的序列号 → 便宜闸 text:serial 命中。 */
const phoneSource = () => ({
  title: '去手机上跑一轮日常',
  remark: '',
  channel: null,
  body: `在 ${SERIAL} 这台手机上点赞十条，跑完回报。`,
});

/** 三闸共用的 Jev 答案：设备判定为真、引擎 codex、部门 dev（便宜闸对正文无硬约束时才生效）。 */
const phoneAnswers = () => ({
  kind: choice('agent', { agent: 0.9, workflow: 0.1 }),
  is_device: noul(0.95),
  engine: choice('codex', { codex: 0.8, terra: 0.2 }),
  department: choice('dev', { dev: 0.8, main: 0.2 }),
  account: choice('not_applicable', { not_applicable: 0.95 }),
  workflow_ref: choice('not_applicable', { not_applicable: 0.95 }),
});

async function insertTask(suffix) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, task_type, status, priority, trigger_source, executor_kind, payload)
     VALUES ($1, $2, 'qiumi_task', 'queued', 'P2', 'manual', 'openclaw-agent', $3::jsonb)
     RETURNING id, title, description, priority, project_id, payload`,
    [`${T} ${suffix}`, '手机活 smoke', JSON.stringify({ qiumi_source: phoneSource() })],
  );
  return rows[0];
}

const taskRow = async (id) => (await pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const eventTypes = async (id) => (await pool.query(
  'SELECT event_type FROM task_events WHERE task_id = $1', [id],
)).rows.map((r) => r.event_type);

/** 直插一条 device_job 子任务，冒充 createRoutedTask 的返回形状（不写路由回执 → 无残渣）。 */
let createdChildren = 0;
async function fakeCreateRoutedTask(p, spec) {
  createdChildren++;
  const { rows } = await p.query(
    `INSERT INTO tasks (title, description, task_type, status, priority, trigger_source, executor_kind, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
    [
      spec.title, spec.description ?? null, spec.requested_task_type, spec.task?.status ?? 'queued',
      spec.task?.priority ?? 'P2', spec.task?.trigger_source ?? 'manual',
      spec.task?.executor_kind ?? 'headed-session', JSON.stringify(spec.metadata ?? {}),
    ],
  );
  return { task: { id: rows[0].id } };
}

/** 假 ssh child：stdin.end 记下灌进去的正文，stdout 回 DISPATCHED，close 0。 */
function makeFakeChild(seen) {
  const listeners = new Map();
  const child = {
    stdout: { handlers: [], on(ev, fn) { if (ev === 'data') this.handlers.push(fn); return this; } },
    stderr: { on() { return this; } },
    stdin: { end: (input) => { seen.stdin = String(input ?? ''); } },
    kill: () => {},
    on(ev, fn) { listeners.set(ev, fn); return this; },
  };
  child.__emit = () => setImmediate(() => {
    for (const fn of child.stdout.handlers) fn(Buffer.from('DISPATCHED\n'));
    listeners.get('close')?.(0);
  });
  return child;
}

/**
 * 只动自己插的行（固定 title 前缀带 pid）。本 smoke 三闸都不走真 createRoutedTask，
 * 正常情况下没有路由回执、整行删得掉；万一别处给这些行补了回执（append-only + 外键删不掉），
 * 就退一步改名 `[smoke-residue] ` 并置 archived，不留活跃行去污染别人的去重索引。
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
  // 注册表真身：手机序列号在 device_locks（迁移 448），device_name=序列号、device_type='phone'。
  await pool.query(
    `INSERT INTO device_locks (device_name, host, device_type) VALUES ($1, $2, 'phone')
     ON CONFLICT (device_name) DO UPDATE SET host = EXCLUDED.host, device_type = 'phone'`,
    [SERIAL, HOST],
  );

  let gate1TaskId = null;

  // ── 闸 1：开关默认关 → 手机活照样派 openclaw agent，只把设备信息留痕成 device_hint ──
  {
    const t = await insertTask('闸1');
    gate1TaskId = t.id;
    const env = qiumiEnv({ JEV_API_KEY: 'k' }); // 不带 QIUMI_DEVICE_DELEGATION_ENABLED = 默认关
    check(1, env.deviceDelegationEnabled === false, `env 开关确实是关的（实得 ${env.deviceDelegationEnabled}）`);
    const before = jevCalls;
    const decision = await routeQiumiTask(t, {
      pool, env, callLLMFn: noTerra, fetchFn: jevStub(phoneAnswers()),
    });
    await persistDecision(pool, t, decision);
    const hint = decision.payloadPatch?.qiumi_route?.device_hint;
    check(1, decision.outcome === 'agent', `outcome=agent（实得 ${decision.outcome}）`);
    check(1, jevCalls === before + 1, `问过一次 Jev（实得 ${jevCalls - before} 次，证明吃的是注入的 stub）`);
    check(1, hint?.serial === SERIAL, `device_hint.serial=${hint?.serial}`);
    check(1, hint?.host === HOST, `device_hint.host=${hint?.host}`);
    check(1, hint?.is_device === true, `device_hint.is_device=${hint?.is_device}`);
    check(1, (hint?.matchedBy ?? []).includes('text:serial'), `device_hint.matchedBy=${JSON.stringify(hint?.matchedBy)}`);

    // 查库：留痕真落进 payload，父任务没被挂起，也没派生子任务。
    const row = await taskRow(t.id);
    const { rows: dbHint } = await pool.query(
      `SELECT payload->'qiumi_route'->'device_hint'->>'serial' AS serial,
              payload->'qiumi_route'->'device_hint'->>'host'   AS host,
              payload->>'model' AS model, payload->>'run_id' AS run_id,
              payload->>'qiumi_department' AS dept
         FROM tasks WHERE id = $1`,
      [t.id],
    );
    check(1, dbHint[0]?.serial === SERIAL, `库里 device_hint.serial=${dbHint[0]?.serial}`);
    check(1, dbHint[0]?.host === HOST, `库里 device_hint.host=${dbHint[0]?.host}`);
    check(1, row.status === 'queued', `父任务仍 queued（实得 ${row.status}）`);
    check(1, row.blocked_reason === null, `父任务没被挂起，blocked_reason=${row.blocked_reason}`);
    check(1, row.task_type === 'qiumi_task', `父任务类型没被改（实得 ${row.task_type}）`);
    check(1, dbHint[0]?.model === 'openai/gpt-5.3-codex', `agent 分支落了模型=${dbHint[0]?.model}`);
    check(1, dbHint[0]?.dept === 'dev', `agent 分支落了部门=${dbHint[0]?.dept}`);
    check(1, /^qiumi-[0-9a-f]{8}-\d{10,}$/.test(dbHint[0]?.run_id ?? ''), `run_id 合规=${dbHint[0]?.run_id}`);
    const { rows: kids } = await pool.query(
      `SELECT id, task_type FROM tasks WHERE payload->>'parent_task_id' = $1`, [t.id],
    );
    check(1, kids.length === 0, `没派生任何子任务（实得 ${kids.length} 条：${kids.map((k) => k.task_type).join(',')}）`);
    check(1, (await eventTypes(t.id)).includes('qiumi_route_decided'), 'task_events 留痕 qiumi_route_decided');
  }

  // ── 闸 2：开关开 → 行为回到旧版（派生 device_job 子任务 + 父任务挂起），证明开关可回滚 ──
  {
    const t = await insertTask('闸2');
    const env = qiumiEnv({ JEV_API_KEY: 'k', QIUMI_DEVICE_DELEGATION_ENABLED: 'true' });
    check(2, env.deviceDelegationEnabled === true, `env 开关确实是开的（实得 ${env.deviceDelegationEnabled}）`);
    const before = jevCalls;
    const beforeChildren = createdChildren;
    const decision = await routeQiumiTask(t, {
      pool, env, callLLMFn: noTerra, fetchFn: jevStub(phoneAnswers()),
    });
    check(2, decision.outcome === 'device', `outcome=device（实得 ${decision.outcome}）`);
    check(2, jevCalls === before, `便宜闸在 Jev 前：一次都没问（实得 ${jevCalls - before} 次）`);
    check(2, decision.serial === SERIAL, `decision.serial=${decision.serial}`);

    const childId = await persistDecision(pool, t, decision, { createRoutedTaskFn: fakeCreateRoutedTask });
    check(2, createdChildren === beforeChildren + 1, `建单函数被调用一次（实得 ${createdChildren - beforeChildren} 次）`);
    const parent = await taskRow(t.id);
    check(2, parent.status === 'blocked', `父任务 status=${parent.status}`);
    check(2, parent.blocked_reason === 'delegated_device_job', `父任务 blocked_reason=${parent.blocked_reason}`);
    check(2, parent.claimed_by === null, `claimed_by 已释放（实得 ${parent.claimed_by}）`);
    check(2, parent.payload?.device_task_id === childId, `父任务 payload.device_task_id=${parent.payload?.device_task_id}`);

    const child = childId ? await taskRow(childId) : null;
    check(2, child?.task_type === 'device_job', `子任务 task_type=${child?.task_type}`);
    check(2, child?.assigned_to === `phone-${SERIAL}`, `子任务 assigned_to=${child?.assigned_to}`);
    check(2, child?.payload?.serial === SERIAL, `子任务 payload.serial=${child?.payload?.serial}`);
    check(2, child?.payload?.parent_task_id === t.id, `子任务 payload.parent_task_id=${child?.payload?.parent_task_id}`);
    check(2, (await eventTypes(t.id)).includes('qiumi_device_delegated'), 'task_events 留痕 qiumi_device_delegated');
  }

  // ── 闸 3：闸 1 落库的那条任务派出去时，prompt 里带着设备提示段，且正文不进命令行 ──
  {
    const t = await taskRow(gate1TaskId);
    const seen = { stdin: null, args: null };
    const spawnFn = (file, args) => {
      seen.file = file;
      seen.args = args;
      const child = makeFakeChild(seen);
      child.__emit();
      return child;
    };
    const r = await triggerOpenclawAgent(t, { spawnFn, pool });
    check(3, r.success === true, `派发成功（实得 ${JSON.stringify(r.reason ?? r.error ?? true)}）`);
    const prompt = seen.stdin ?? '';
    check(3, prompt.includes('设备提示'), 'prompt 含「设备提示」段');
    check(3, prompt.includes(SERIAL), `prompt 含序列号 ${SERIAL}`);
    check(3, prompt.includes(NODE_NAME), `prompt 含 OpenClaw 节点名 ${NODE_NAME}`);
    check(3, prompt.includes('douyin-phone-adb'), 'prompt 点名控制器 douyin-phone-adb');
    check(3, prompt.includes('lock-acquire'), 'prompt 交代了锁（lock-acquire）');
    const argv = (seen.args ?? []).join(' ');
    check(3, seen.file === 'ssh', `走的是 ssh（实得 ${seen.file}）`);
    check(3, argv.length > 0 && !argv.includes(SERIAL), '序列号不进命令行（正文只走 stdin）');
    check(3, !argv.includes('设备提示'), '设备提示段不进命令行');
    check(3, argv.includes('M=$(cat)'), '远端命令确实从 stdin 读正文（M=$(cat)）');
    check(3, (await eventTypes(t.id)).includes('openclaw_agent_spawned'), 'task_events 留痕 openclaw_agent_spawned');
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
