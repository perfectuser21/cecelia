/**
 * 秋米「用 <型号>」真库 smoke：真 Postgres（cecelia_test）+ 假 Jev（注入 fetchFn），不打真 LLM、不碰真机。
 *
 * 验的是本刀新开的那条缝：正文写「用 <型号>」时，型号只认 `QIUMI_MODEL_ALLOWLIST`（OpenClaw
 * agents.defaults.modelPolicy.allow 原样），命中即压过 engine → modelMap 查表；没命中就当没写过。
 * 判定层旧三闸在 qiumi-routing-smoke，手机活开关在 qiumi-phone-agent-smoke，本刀都不重复。
 *
 *  1 清单内全名命中 + 真落库：正文「用 grok-4.7」→ outcome='agent'、model='xai/grok-4.7'、
 *    payloadPatch.qiumi_route.cheap.hardModel 同值且 matchedBy 含 'text:model'。
 *    同时断言 engine 仍是 Jev 答的 codex ——证明 hardModel 是**压过**了 modelMap[engine]
 *    （codex 本该得 openai/gpt-5.3-codex），不是恰好两边同值蹭过去的。
 *    persistDecision 后查两处真表：tasks.payload->>'model'，以及 task_events 里该任务
 *    'qiumi_route_decided' 事件的 payload->>'model'。事件由 recordTaskEventSafe 真函数写（本 smoke
 *    没 mock 它，pool 是真池），所以两处都是真行查出来的，不是拿返回值自证。
 *  2 短名歧义：正文「用 opus-5」→ 'anthropic/claude-opus-5'，**不是** 'anthropic/claude-opus-5-5'
 *    （后者短名以 -5 结尾，resolveModelRef 的「后缀唯一才算」这条若写松就会撞上它）；
 *    正文「用 sol」→ 'openai/gpt-5.6-sol'（纯后缀命中那一档）。
 *  3 不写型号与原生 claude：正文「写周报」不含任何型号 → model 回落 env.modelMap[engine]（engine=terra
 *    → 'openai/gpt-5.6-terra'）且 matchedBy 不含 'text:model'；正文「用 claude」→ hardEngine='claude'
 *    但 hardModel=null（'claude' 不在清单里，也不是任何短名/后缀），model='anthropic/claude-sonnet-5'
 *    ——即 claude 通道已从判死的 claude-cli 改成 anthropic 原生（债 419ab185）。
 *
 * 清单由 .sh 导出（并在那里 unset QIUMI_MODEL_MAP，执行机上可能配了覆盖），本文件先断言它真到位，
 * 清单空掉时直接红在闸 0，不让三闸变成「清单没配所以都没命中」的假绿。
 *
 * 变异验证（proven-to-fire，不留在文件里）：把闸 1 的期望 model 由 'xai/grok-4.7' 改成 'xai/grok-4.6'
 * 跑一次，本 smoke 必红——说明闸 1 咬的是真行为。
 *
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

async function main() {
  await cleanup();

  // ── 闸 0：清单真到位（.sh 的 export 是本 smoke 的地基，空清单 = 三闸全假绿）──
  {
    const env = envFor();
    const list = env.modelAllowlist;
    check(0, list.length === 5, `清单载入 5 条（实得 ${list.length}：${JSON.stringify(list)}）`);
    check(0, list.includes('xai/grok-4.7'), '清单含 xai/grok-4.7');
    check(0, list.includes('anthropic/claude-opus-5') && list.includes('anthropic/claude-opus-5-5'),
      '清单含 opus-5 与 opus-5-5 两条（闸 2 的歧义素材）');
    check(0, env.modelMap.codex === 'openai/gpt-5.3-codex',
      `modelMap.codex 未被执行机覆盖（实得 ${env.modelMap.codex}）`);
  }

  // ── 闸 1：清单内全名命中 → hardModel 压过 engine 查表，且两张真表都落到 ──
  {
    const { task, decision, jevCalled } = await route(
      '闸1', '这条活派出去跑', '这条活用 grok-4.7 跑，跑完回报进度。', 'codex',
    );
    const cheap = decision.payloadPatch?.qiumi_route?.cheap;
    check(1, decision.outcome === 'agent', `outcome=agent（实得 ${decision.outcome}）`);
    check(1, jevCalled === 1, `问过一次 Jev（实得 ${jevCalled} 次，证明吃的是注入的 stub）`);
    check(1, decision.model === 'xai/grok-4.7', `decision.model=${decision.model}`);
    check(1, cheap?.hardModel === 'xai/grok-4.7', `cheap.hardModel=${cheap?.hardModel}`);
    check(1, (cheap?.matchedBy ?? []).includes('text:model'), `matchedBy=${JSON.stringify(cheap?.matchedBy)}`);
    // 压过而非同值：engine 是 Jev 答的 codex，若 hardModel 没生效这里会是 openai/gpt-5.3-codex。
    check(1, decision.engine === 'codex', `engine 仍按 Jev=codex（实得 ${decision.engine}）`);
    check(1, decision.model !== envFor().modelMap.codex, 'model 确实偏离了 modelMap[codex]（= 压过，非巧合）');

    const row = await dbModel(task.id);
    check(1, row?.model === 'xai/grok-4.7', `库里 tasks.payload.model=${row?.model}`);
    check(1, row?.hard_model === 'xai/grok-4.7', `库里 qiumi_route.cheap.hardModel=${row?.hard_model}`);
    const ev = await eventModel(task.id);
    check(1, ev?.model === 'xai/grok-4.7', `库里 task_events(qiumi_route_decided).model=${ev?.model}`);
    check(1, ev?.engine === 'codex', `库里事件 engine=${ev?.engine}`);
  }

  // ── 闸 2：短名歧义——opus-5 不许撞上 opus-5-5；纯后缀 sol 要认得 ──
  {
    const a = await route('闸2a', '重写一版', '这份稿子用 opus-5 重写一版。', 'codex');
    check(2, a.decision.model === 'anthropic/claude-opus-5', `「用 opus-5」→ ${a.decision.model}`);
    check(2, a.decision.model !== 'anthropic/claude-opus-5-5', '没被 opus-5-5 抢走（后缀唯一性守住）');
    const aRow = await dbModel(a.task.id);
    check(2, aRow?.model === 'anthropic/claude-opus-5', `库里 model=${aRow?.model}`);

    const b = await route('闸2b', '写一版文案', '这条用 sol 写一版文案。', 'codex');
    check(2, b.decision.model === 'openai/gpt-5.6-sol', `「用 sol」→ ${b.decision.model}`);
    const bRow = await dbModel(b.task.id);
    check(2, bRow?.model === 'openai/gpt-5.6-sol', `库里 model=${bRow?.model}`);
  }

  // ── 闸 3：不写型号回落 modelMap[engine]；「用 claude」走 anthropic 原生（不再是 claude-cli）──
  {
    const env = envFor();
    const a = await route('闸3a', '写周报', '把这周的周报写出来，条目按部门分。', 'terra');
    check(3, a.decision.engine === 'terra', `engine=terra（实得 ${a.decision.engine}）`);
    check(3, a.decision.model === env.modelMap.terra, `不写型号 → modelMap.terra=${a.decision.model}`);
    check(3, a.decision.model === 'openai/gpt-5.6-terra', `默认模型字面量=${a.decision.model}`);
    const aCheap = a.decision.payloadPatch?.qiumi_route?.cheap;
    check(3, aCheap?.hardModel === null, `hardModel 为空（实得 ${JSON.stringify(aCheap?.hardModel)}）`);
    check(3, !(aCheap?.matchedBy ?? []).includes('text:model'),
      `matchedBy 不含 text:model（实得 ${JSON.stringify(aCheap?.matchedBy)}）`);

    const b = await route('闸3b', '改一版', '这条用 claude 改一版，别改结构。', 'terra');
    const bCheap = b.decision.payloadPatch?.qiumi_route?.cheap;
    check(3, bCheap?.hardEngine === 'claude', `「用 claude」→ hardEngine=${bCheap?.hardEngine}`);
    check(3, bCheap?.hardModel === null, `'claude' 不在清单里，hardModel=${JSON.stringify(bCheap?.hardModel)}`);
    check(3, b.decision.engine === 'claude', `engine 被便宜闸定成 claude（实得 ${b.decision.engine}）`);
    check(3, b.decision.model === 'anthropic/claude-sonnet-5', `claude 通道走原生 API：${b.decision.model}`);
    check(3, !String(b.decision.model).includes('claude-cli'), 'claude-cli 通道已判死，不再出现在 model 里');
    const bRow = await dbModel(b.task.id);
    check(3, bRow?.model === 'anthropic/claude-sonnet-5', `库里 model=${bRow?.model}`);
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

console.log(failed === 0 ? `\nALL PASS（${passed} 项断言，闸 0 + 三闸全过）` : `\nFAILED：${failed} 项不通过 / ${passed} 项通过`);
process.exit(failed === 0 ? 0 : 1);
