/**
 * routing/jev-client.js —— 六问 schema 与 Jev→terra→fail 阶梯。
 *
 * 本文件原名 __tests__/qiumi-jev-client.test.js，按源文件拆出 env/redact 两块后改到此处
 * （lint-test-pairing 要求 src/routing/ 下每个源文件配一个同目录 __tests__/<name>.test.js）。
 * 断言一字未改。qiumiEnv 在这里只当夹具用，它自己的断言在 env.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { qiumiEnv } from '../env.js';
import { buildJevQuestions, decideWithFallback } from '../jev-client.js';

// Jev 真实响应格式（2026-09-23 实测 TypeSafe /v1/systemone，两种 type 形状不同）：
// - noul 型（仅 is_device）：{"type":"noul","noul":0.95}——字段名是 noul（true 的概率），没有 confidence。
// - choice 型：{"type":"choice","choice":"workflow","confidence":0.05,"probabilities":{"workflow":0.52,"agent":0.48}}
//   ——confidence 是边际置信度（top1-top2），不是被选中选项的概率，概率在 probabilities 里。
const okJev = (overrides = {}) => ({
  ok: true, status: 200,
  json: async () => ({
    model: 'jev-1.13.0',
    answers: {
      kind: { type: 'choice', choice: 'workflow', confidence: 0.05, probabilities: { workflow: 0.52, agent: 0.48 } },
      is_device: { type: 'noul', noul: 0.95 },
      engine: { type: 'choice', choice: 'claude', confidence: 1.0, probabilities: { claude: 1.0, codex: 0, terra: 0 } },
      department: { type: 'choice', choice: 'dev', confidence: 0.9, probabilities: { dev: 0.9 } },
      account: { type: 'choice', choice: 'not_applicable', confidence: 0.9, probabilities: { not_applicable: 0.9 } },
      workflow_ref: { type: 'choice', choice: 'not_applicable', confidence: 0.9, probabilities: { not_applicable: 0.9 } },
      ...overrides,
    },
    usage: { input_tokens: 400, output_tokens: 40 },
  }),
});

describe('buildJevQuestions', () => {
  it('六个问题：kind/is_device/engine/department/account/workflow_ref，池空则 not_applicable', () => {
    const q = buildJevQuestions({ departments: ['main', 'dev'], accountPool: ['ANGYVB4227006983'], workflowPool: ['朋友圈跟圈'] });
    expect(Object.keys(q)).toEqual(['kind', 'is_device', 'engine', 'department', 'account', 'workflow_ref']);
    expect(q.kind.criteria).toEqual({ agent: expect.any(String), workflow: expect.any(String) });
    expect(q.is_device.type).toBe('noul');
    expect(Object.keys(q.engine.criteria)).toEqual(['claude', 'codex', 'terra']);
    expect(Object.keys(q.department.criteria)).toEqual(['main', 'dev']);
    expect(Object.keys(q.account.criteria)).toEqual(['ANGYVB4227006983', 'not_applicable']);
    expect(Object.keys(q.workflow_ref.criteria)).toEqual(['朋友圈跟圈', 'not_applicable']);
  });
});

describe('decideWithFallback', () => {
  const env = qiumiEnv({ JEV_API_KEY: 'k' });
  const questions = buildJevQuestions({ departments: env.departments, accountPool: [], workflowPool: [] });

  it('Jev 200 → source=jev，请求带 Bearer 与 model，state 已打码', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJev());
    const r = await decideWithFallback({ state: 'token: SECRET 用 Claude Code 做', questions, env, fetchFn, callLLMFn: vi.fn() });
    expect(r.source).toBe('jev');
    expect(r.answers.engine.choice).toBe('claude');
    // noul 型：读 noul 字段算 p，按阈值给 verdict（真实响应没有 confidence，不能读 a.confidence）
    expect(r.answers.is_device).toEqual({ p: 0.95, verdict: true });
    // choice 型：choice/confidence/probabilities 原样透传
    expect(r.answers.kind).toEqual({ choice: 'workflow', confidence: 0.05, probabilities: { workflow: 0.52, agent: 0.48 } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(env.jevEndpoint);
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('jev-latest');
    expect(body.state).not.toContain('SECRET');
    expect(body.questions).toEqual(questions);
  });

  it('Jev 超时一次后成功 → 仍 source=jev，fetch 调 2 次', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(okJev());
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn: vi.fn() });
    expect(r.source).toBe('jev');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Jev 两次都挂 → terra 兜底（callLLM provider=openai model=fallbackModel timeout=20000），解析 JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const callLLMFn = vi.fn().mockResolvedValue({ text: JSON.stringify({
      kind: { choice: 'agent', confidence: 0.8 }, is_device: { noul: 0.05 },
      engine: { choice: 'terra', confidence: 0.7 }, department: { choice: 'main', confidence: 0.6 },
      account: null, workflow_ref: null,
    }) });
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn });
    expect(r.source).toBe('terra');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(callLLMFn).toHaveBeenCalledTimes(1);
    expect(callLLMFn.mock.calls[0][2]).toMatchObject({ provider: 'openai', model: 'gpt-5.6-terra', timeout: 20000 });
    expect(r.answers.engine.choice).toBe('terra');
    expect(r.answers.is_device).toEqual({ p: 0.05, verdict: false });
  });

  it('terra 第一次回非 JSON、第二次 JSON → 重试 1 次成功', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const callLLMFn = vi.fn()
      .mockResolvedValueOnce({ text: '不是 json' })
      .mockResolvedValueOnce({ text: JSON.stringify({ kind: { choice: 'agent', confidence: 0.9 }, is_device: { noul: 0.05 }, engine: { choice: 'codex', confidence: 0.9 }, department: { choice: 'dev', confidence: 0.9 }, account: null, workflow_ref: null }) });
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn });
    expect(r.source).toBe('terra');
    expect(callLLMFn).toHaveBeenCalledTimes(2);
  });

  it('Jev 与 terra 全挂 → source=fail，绝不返回可执行决策', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const callLLMFn = vi.fn().mockRejectedValue(new Error('bridge down'));
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn });
    expect(r).toEqual({ source: 'fail', reason: 'qiumi_router_unavailable' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(callLLMFn).toHaveBeenCalledTimes(2);
  });

  it('Jev 返回池外账号（幻觉/越权）→ account 视为未选，不当真结果传下去', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJev({ account: { type: 'choice', choice: 'GHOST_NOT_IN_POOL', confidence: 0.95 } }));
    const poolQuestions = buildJevQuestions({ departments: env.departments, accountPool: ['ANGYVB4227006983'], workflowPool: [] });
    const r = await decideWithFallback({ state: 'x', questions: poolQuestions, env, fetchFn, callLLMFn: vi.fn() });
    expect(r.source).toBe('jev');
    expect(r.answers.account).toBeNull();
  });

  it('缺 JEV_API_KEY → 不调 Jev，直接 terra', async () => {
    const fetchFn = vi.fn();
    const callLLMFn = vi.fn().mockResolvedValue({ text: JSON.stringify({ kind: { choice: 'agent', confidence: 0.9 }, is_device: { noul: 0.05 }, engine: { choice: 'terra', confidence: 0.9 }, department: { choice: 'main', confidence: 0.9 }, account: null, workflow_ref: null }) });
    const r = await decideWithFallback({ state: 'x', questions, env: qiumiEnv({}), fetchFn, callLLMFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.source).toBe('terra');
  });

  it('noul 缺失/非数值 → is_device 判 ambiguous（不当 false 处理，fail-closed 交给 Task 3）', async () => {
    const fetchFn1 = vi.fn().mockResolvedValue(okJev({ is_device: { type: 'noul' } }));
    const r1 = await decideWithFallback({ state: 'x', questions, env, fetchFn: fetchFn1, callLLMFn: vi.fn() });
    expect(r1.answers.is_device).toEqual({ p: null, verdict: 'ambiguous' });

    const fetchFn2 = vi.fn().mockResolvedValue(okJev({ is_device: { type: 'noul', noul: '高' } }));
    const r2 = await decideWithFallback({ state: 'x', questions, env, fetchFn: fetchFn2, callLLMFn: vi.fn() });
    expect(r2.answers.is_device).toEqual({ p: null, verdict: 'ambiguous' });
  });

  it('noul 处于中间地带（0.2<p<0.8）→ ambiguous', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJev({ is_device: { type: 'noul', noul: 0.5 } }));
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn: vi.fn() });
    expect(r.answers.is_device).toEqual({ p: 0.5, verdict: 'ambiguous' });
  });
});
