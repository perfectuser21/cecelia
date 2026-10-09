// packages/brain/src/routing/jev-client.js
/**
 * 判定阶梯（主理人拍板）：Jev 3s → 重试 1 次 → terra 20s → 重试 1 次 → fail。
 * 兜底只兜"判定"，绝不跳过判定去执行；fail 由 qiumi-router 落 failed。
 * Jev 请求：POST {model, state, questions:{name:{type:choice|noul, instructions, criteria}}}
 * Jev 响应（2026-09-23 实测 TypeSafe /v1/systemone，两种 type 形状不同，勿假设统一）：
 *   - choice 类型：{"type":"choice","choice":"workflow","confidence":0.05,"probabilities":{"workflow":0.52,"agent":0.48}}
 *     confidence 是边际置信度，不是被选中选项的概率——概率在 probabilities 里；choice/confidence/probabilities 原样透传。
 *   - noul 类型（仅 is_device）：{"type":"noul","noul":0.95}，没有 confidence 字段；
 *     noul = 该任务需要碰真机（is_device=true）的概率。归一化为 { p, verdict }：
 *     p>=NOUL_THRESHOLDS.high → verdict:true；p<=NOUL_THRESHOLDS.low → verdict:false；否则/缺失/非数值 → 'ambiguous'。
 *     ambiguous 不在本文件 fail-closed（那是 Task 3 cheap-gates/qiumi-router 的职责），这里只负责如实归一化。
 */
import { redactSecrets } from './redact.js';

export const JEV_TIMEOUT_MS = 3000;
export const TERRA_TIMEOUT_MS = 20000;
// is_device (noul) 判定阈值——Task 3 复用：<0.8 或无法解析 → 不派（fail-closed）
export const NOUL_THRESHOLDS = Object.freeze({ high: 0.8, low: 0.2 });
const ENGINES = { claude: '正文明确要求用 Claude / Claude Code', codex: '正文明确要求用 Codex', terra: '没有明确指定引擎，走默认通用' };

export function buildJevQuestions({ departments, accountPool = [], workflowPool = [] }) {
  const listToCriteria = (arr, na) => Object.fromEntries([...arr.map((v) => [v, `选项 ${v}`]), [na, '不适用/无法确定']]);
  return {
    kind: { type: 'choice', instructions: '这是单个 agent 就能完成的活，还是要跑一条既定工作流？', criteria: { agent: '一次对话/一次执行就能交付', workflow: '需要按既定多步流程（如发布/采集/跟圈）执行' } },
    is_device: { type: 'noul', instructions: '这条任务是否需要操作真实手机/设备（adb、点赞、发布、私信等）？', criteria: { true: '需要碰真机', false: '不需要碰真机' } },
    engine: { type: 'choice', instructions: '该用哪个执行引擎？没有明确指定就选 terra', criteria: ENGINES },
    department: { type: 'choice', instructions: '该由哪个部门 agent 负责？', criteria: Object.fromEntries(departments.map((d) => [d, `部门 ${d}`])) },
    account: { type: 'choice', instructions: '若需设备/账号，用哪一个？只能从给定池中选，不确定选 not_applicable', criteria: listToCriteria(accountPool, 'not_applicable') },
    workflow_ref: { type: 'choice', instructions: '若 kind=workflow，对应哪条已登记工作流？否则 not_applicable', criteria: listToCriteria(workflowPool, 'not_applicable') },
  };
}

const NAMES = ['kind', 'is_device', 'engine', 'department', 'account', 'workflow_ref'];
// 账号/工作流只能取给定 criteria 池内值；池外（幻觉/越权）→ 视为未选（Global Constraints）
const POOL_BOUND_NAMES = new Set(['account', 'workflow_ref']);

// is_device 是 noul 型：Jev 真实响应字段名是 noul（true 的概率），没有 confidence。
// 归一化为 { p, verdict }，verdict ambiguous 由 Task 3 fail-closed；本函数只如实转换，不判定。
function normalizeNoul(a) {
  const p = Number(a?.noul);
  if (!Number.isFinite(p)) return { p: null, verdict: 'ambiguous' };
  const verdict = p >= NOUL_THRESHOLDS.high ? true : p <= NOUL_THRESHOLDS.low ? false : 'ambiguous';
  return { p, verdict };
}

function normalizeAnswers(raw, questions) {
  const out = {};
  for (const n of NAMES) {
    const a = raw?.[n];
    if (n === 'is_device') { out[n] = normalizeNoul(a); continue; }
    if (!a || typeof a !== 'object' || a.choice == null) { out[n] = null; continue; }
    const choice = String(a.choice);
    if (POOL_BOUND_NAMES.has(n)) {
      const pool = questions?.[n]?.criteria ? Object.keys(questions[n].criteria) : null;
      if (pool && !pool.includes(choice)) { out[n] = null; continue; }
    }
    // choice 型原样透传 choice/confidence/probabilities（confidence 是边际置信度，不是被选中选项的概率）
    out[n] = { choice, confidence: Number(a.confidence ?? 0), probabilities: a.probabilities ?? null };
  }
  if (!out.kind || !out.is_device || !out.engine || !out.department) return null;
  return out;
}

async function askJevOnce({ state, questions, env, fetchFn }) {
  const res = await fetchFn(env.jevEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.jevApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.jevModel, state, questions }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`jev_http_${res.status}`);
  const json = await res.json();
  const answers = normalizeAnswers(json?.answers, questions);
  if (!answers) throw new Error('jev_schema_invalid');
  return answers;
}

function terraPrompt(state, questions) {
  return [
    '你是任务路由器。只输出一个 JSON 对象，不要任何解释。',
    '按下面 questions 逐题作答：is_device 是 noul 型，只输出 {"noul":0~1}（noul=该任务需要碰真机的概率，不要用 choice/confidence 字段）；',
    '其余是 choice 型，形如 {"choice":"<选项>","confidence":0~1,"probabilities":{...}}；account/workflow_ref 无法确定填 null。',
    `questions=${JSON.stringify(questions)}`,
    `state=${JSON.stringify(state)}`,
  ].join('\n');
}

async function askTerraOnce({ state, questions, env, callLLMFn }) {
  const r = await callLLMFn('qiumi-router', terraPrompt(state, questions), { provider: 'openai', model: env.fallbackModel, timeout: TERRA_TIMEOUT_MS, maxTokens: 400 });
  const text = typeof r === 'string' ? r : r?.text;
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('terra_not_json');
  const answers = normalizeAnswers(JSON.parse(m[0]), questions);
  if (!answers) throw new Error('terra_schema_invalid');
  return answers;
}

export async function decideWithFallback({ state, questions, env, fetchFn = globalThis.fetch, callLLMFn, now = Date.now }) {
  const t0 = now();
  const redacted = redactSecrets(state);
  if (env.jevApiKey) {
    for (let i = 0; i < 2; i++) {
      try { return { source: 'jev', answers: await askJevOnce({ state: redacted, questions, env, fetchFn }), latencyMs: now() - t0 }; } catch { /* 重试/降级 */ }
    }
  }
  for (let i = 0; i < 2; i++) {
    try { return { source: 'terra', answers: await askTerraOnce({ state: redacted, questions, env, callLLMFn }), latencyMs: now() - t0 }; } catch { /* 重试/失败 */ }
  }
  return { source: 'fail', reason: 'qiumi_router_unavailable' };
}
