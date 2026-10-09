/**
 * 秋米模型选择真库 smoke（任务 0d4215f2 起）：真 Postgres（cecelia_test）+ 假 Jev（注入 fetchFn），
 * 不打真 LLM、不碰真机。
 *
 * 0928 起模型只认正文【执行参数】块里的「模型」字段（别名或允许清单精确匹配），正文自由文字一律不产生
 * 模型；不写模型 → payload.model 为 null，由 OpenClaw 用该 agent 自身默认模型。此前「用 <型号>」正则把
 * 模板里的「调用Agent：」匹配成 agent → xai/grok-4.20-multi-agent，09-23 起 Notion 秋米任务全挂。
 *
 *  0 清单真到位（.sh 导出），空清单时各闸会退化成假绿。
 *  1 参数块全名：「模型：grok-4.7」→ model='xai/grok-4.7'，tasks.payload 与 task_events 两张真表都落到；
 *    没写执行者所以仍问 Jev（engine=codex），且 model 偏离 modelMap[codex]——证明是参数定的。
 *  2 精确匹配：「模型：claude-opus-5」不撞 opus-5-5；「模型：agent」这类非精确词 → exec_params_invalid。
 *  3 回归：真实模板正文「调用Agent：调用抖音平台数据采集 Agent」→ hardModel 与 model 都为 null；
 *    完全不写模型 → 库里 model 为 null。
 *  4 直派：「执行Agent：dev」→ 不问 Jev，source=explicit，库里 qiumi_department=dev。
 *
 * 变异验证（proven-to-fire，不留在文件里）：把闸 1 期望改成 'xai/grok-4.6' 跑一次必红。
 * 只删自己插的行（固定 title 前缀带 pid），绝不动别人的行。
 */
import pg from 'pg';
import { qiumiEnv } from '../../src/routing/env.js';
import { routeQiumiTask, persistDecision } from '../../src/routing/qiumi-router.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const T = `[smoke] qiumi-model-allowlist ${process.pid}`;

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

/** 清单只在 .sh 里导出一次，env 由本文件按闸构造（不吃执行机 process.env 的 QIUMI_MODEL_MAP）。 */
const ALLOWLIST_RAW = process.env.QIUMI_MODEL_ALLOWLIST ?? '';
const envFor = () => qiumiEnv({ JEV_API_KEY: 'k', QIUMI_MODEL_ALLOWLIST: ALLOWLIST_RAW });

/** 非设备活的 Jev 答案：engine 由各闸指定，is_device 判假（开关默认关，device 闸本来也不生效）。 */
const answersWith = (engine) => ({
  kind: choice('agent', { agent: 0.9, workflow: 0.1 }),
  is_device: noul(0.02),
  engine: choice(engine, { [engine]: 0.9 }),
  department: choice('dev', { dev: 0.8, main: 0.2 }),
  account: choice('not_applicable', { not_applicable: 0.95 }),
  workflow_ref: choice('not_applicable', { not_applicable: 0.95 }),
});

async function insertTask(suffix, title, body) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, task_type, status, priority, trigger_source, executor_kind, payload)
     VALUES ($1, $2, 'qiumi_task', 'queued', 'P2', 'manual', 'openclaw-agent', $3::jsonb)
     RETURNING id, title, description, priority, project_id, payload`,
    [
      `${T} ${suffix}`, '型号清单 smoke',
      JSON.stringify({ qiumi_source: { title, remark: '', channel: null, body } }),
    ],
  );
  return rows[0];
}

/** 跑一条：建任务 → 路由（假 Jev）→ 落库，返回决策与任务行。 */
async function route(suffix, title, body, engine) {
  const t = await insertTask(suffix, title, body);
  const before = jevCalls;
  const decision = await routeQiumiTask(t, {
    pool, env: envFor(), callLLMFn: noTerra, fetchFn: jevStub(answersWith(engine)),
  });
  await persistDecision(pool, t, decision);
  return { task: t, decision, jevCalled: jevCalls - before };
}

const dbModel = async (id) => (await pool.query(
  `SELECT payload->>'model' AS model,
          payload->'qiumi_route'->'cheap'->>'hardModel' AS hard_model
     FROM tasks WHERE id = $1`, [id],
)).rows[0];
const eventModel = async (id) => (await pool.query(
  `SELECT payload->>'model' AS model, payload->>'engine' AS engine
     FROM task_events
    WHERE task_id = $1 AND event_type = 'qiumi_route_decided'
    ORDER BY created_at DESC LIMIT 1`, [id],
)).rows[0];

/** 只动自己插的行（固定 title 前缀带 pid）。本 smoke 不走真 createRoutedTask，无路由回执，整行删得掉。 */
async function cleanup() {
  const { rows } = await pool.query('SELECT id FROM tasks WHERE title LIKE $1', [`${T}%`]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  await pool.query('DELETE FROM task_events WHERE task_id = ANY($1::uuid[])', [ids]);
  await pool.query(
    'DELETE FROM tasks WHERE id = ANY($1::uuid[]) AND id NOT IN (SELECT task_id FROM work_routing_receipts)',
    [ids],
  );
}

const P = (lines, rest = '按上面的参数执行。') => `【执行参数】\n${lines.join('\n')}\n【执行参数结束】\n${rest}`;

async function main() {
  await cleanup();

  // ── 闸 0：清单真到位 ──
  {
    const list = envFor().modelAllowlist;
    check(0, list.length === 5, `清单载入 5 条（实得 ${list.length}：${JSON.stringify(list)}）`);
    check(0, list.includes('xai/grok-4.7'), '清单含 xai/grok-4.7');
    check(0, list.includes('anthropic/claude-opus-5') && list.includes('anthropic/claude-opus-5-5'),
      '清单含 opus-5 与 opus-5-5 两条（闸 2 的歧义素材）');
  }

  // ── 闸 1：参数块写全名 → 模型照办，两张真表都落到 ──
  {
    const { task, decision, jevCalled } = await route('闸1', '这条活派出去跑', P(['模型：grok-4.7']), 'codex');
    check(1, decision.outcome === 'agent', `outcome=agent（实得 ${decision.outcome}）`);
    check(1, jevCalled === 1, `没写执行者 → 仍问一次 Jev（实得 ${jevCalled} 次）`);
    check(1, decision.model === 'xai/grok-4.7', `decision.model=${decision.model}`);
    check(1, decision.engine === 'codex', `engine 仍按 Jev=codex（实得 ${decision.engine}）`);
    check(1, decision.model !== envFor().modelMap.codex, 'model 偏离 modelMap[codex]（参数定的，非巧合）');
    const row = await dbModel(task.id);
    check(1, row?.model === 'xai/grok-4.7', `库里 tasks.payload.model=${row?.model}`);
    const ev = await eventModel(task.id);
    check(1, ev?.model === 'xai/grok-4.7', `库里 task_events(qiumi_route_decided).model=${ev?.model}`);
  }

  // ── 闸 2：精确匹配——opus-5 不撞 opus-5-5；非精确词判参数错误 ──
  {
    const a = await route('闸2a', '重写一版', P(['模型：claude-opus-5']), 'codex');
    check(2, a.decision.model === 'anthropic/claude-opus-5', `「模型：claude-opus-5」→ ${a.decision.model}`);
    const aRow = await dbModel(a.task.id);
    check(2, aRow?.model === 'anthropic/claude-opus-5', `库里 model=${aRow?.model}`);

    const b = await route('闸2b', '写一版文案', P(['模型：agent']), 'codex');
    check(2, b.decision.outcome === 'fail', `「模型：agent」→ outcome=${b.decision.outcome}`);
    check(2, b.decision.reason === 'exec_params_invalid', `reason=${b.decision.reason}`);
    check(2, b.jevCalled === 0, `参数写错不去问 Jev（实得 ${b.jevCalled} 次）`);
  }

  // ── 闸 3：回归——模板里的「调用Agent：」不产生模型；不写模型库里就是 null ──
  {
    const tpl = '任务目标\n使用手机： 小彩手机\n调用Agent： 调用抖音平台数据采集 Agent \n执行要求';
    const a = await route('闸3a', '抖音作品数据采集', tpl, 'terra');
    const aCheap = a.decision.payloadPatch?.qiumi_route?.cheap;
    check(3, aCheap?.hardModel === null, `hardModel 为空（实得 ${JSON.stringify(aCheap?.hardModel)}）`);
    check(3, !(aCheap?.matchedBy ?? []).includes('text:model'), `matchedBy 不含 text:model（实得 ${JSON.stringify(aCheap?.matchedBy)}）`);
    check(3, a.decision.model === null, `decision.model 为空（实得 ${a.decision.model}）`);
    const aRow = await dbModel(a.task.id);
    check(3, aRow?.model === null, `库里 model 为空（实得 ${aRow?.model}）`);

    const b = await route('闸3b', '写周报', '把这周的周报写出来，条目按部门分。', 'terra');
    check(3, b.decision.engine === 'terra', `engine=terra（实得 ${b.decision.engine}）`);
    check(3, b.decision.model === null, `不写模型 → 不再由 engine 推导（实得 ${b.decision.model}）`);
  }

  // ── 闸 4：写明执行者 → 直派不问 Jev ──
  {
    const { task, decision, jevCalled } = await route('闸4', '写周报', P(['执行Agent：dev']), 'codex');
    check(4, decision.outcome === 'agent' && decision.department === 'dev', `直派 dev（实得 ${decision.outcome}/${decision.department}）`);
    check(4, jevCalled === 0, `没问 Jev（实得 ${jevCalled} 次）`);
    check(4, decision.payloadPatch?.qiumi_route?.source === 'explicit', `source=${decision.payloadPatch?.qiumi_route?.source}`);
    const dept = (await pool.query("SELECT payload->>'qiumi_department' AS d FROM tasks WHERE id = $1", [task.id])).rows[0]?.d;
    check(4, dept === 'dev', `库里 qiumi_department=${dept}`);
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

console.log(failed === 0 ? `\nALL PASS（${passed} 项断言，闸 0–4 全过）` : `\nFAILED：${failed} 项不通过 / ${passed} 项通过`);
process.exit(failed === 0 ? 0 : 1);
