// Contract Proposer 测试 — 方向闸命门质量来源。
// LLM 调用全 mock(注入 fetch stub / 设 env),0 真实 token 消耗。
// 注意: contract.mjs 是 .mjs(被 node 原生跑),测试用 .ts 通过 vitest 引入。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proposeContract, renderContract } from './contract.mjs';

// 构造一个合法的 OpenRouter chat/completions 响应
function llmResponse(contentObj: unknown) {
  const content = typeof contentObj === 'string' ? contentObj : JSON.stringify(contentObj);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'test',
      model: 'deepseek/deepseek-chat',
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    text: async () => '',
  };
}

describe('proposeContract — demo-cache 确定性分支(命门 demo 防回归)', () => {
  beforeEach(() => {
    // demo 分支不该碰网络;若碰了就让它炸,证明走的是确定性路径
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('demo-cache 分支不应调用 LLM/fetch');
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('无 steer → 前端 localStorage 方案(逐字不变)', async () => {
    const task = { id: 'demo-cache', title: '给 daily-report 加缓存', description: '报表每次都重算,慢' };
    const c = await proposeContract(task);
    expect(c.approach).toBe('在 Dashboard 前端用 localStorage 缓存 daily-report,过期 5 分钟');
    expect(c.files).toEqual(['apps/dashboard/src/pages/DailyReport.tsx']);
    expect(c.tests).toEqual(['前端单测: localStorage 命中/过期']);
    expect(c.risk).toBe('前端各端不共享、刷新即丢、多用户不一致');
    expect(c._fallback).toBeFalsy();
  });

  it('有 steer → 服务端 Redis 方案(逐字不变,含 steer 文本)', async () => {
    const task = { id: 'demo-cache', title: '给 daily-report 加缓存', description: '报表每次都重算,慢' };
    const steer = '缓存要放服务端 Redis,不是前端 localStorage';
    const c = await proposeContract(task, steer);
    expect(c.approach).toBe(
      `据主理人方向[${steer}]: 在 Brain 服务端缓存 daily-report(Redis,TTL 5min),前端只读 API`,
    );
    expect(c.files).toEqual(['apps/api/src/system/daily-report.ts', 'apps/api/src/shared/cache.ts']);
    expect(c._fallback).toBeFalsy();
  });
});

describe('proposeContract — 真 LLM 分支(mock)', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('正常: LLM 返回合法 JSON → 解析出 {approach,files,tests,risk}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        llmResponse({
          approach: '在 worker 层加重试队列',
          files: ['apps/api/src/worker/retry.ts'],
          tests: ['集成测试: 失败任务进队列并重试'],
          risk: '重试风暴需限流',
        }),
      ),
    );
    const task = { id: 'task-42', title: '任务失败要自动重试', description: '现在失败就丢了' };
    const c = await proposeContract(task);
    expect(c.approach).toBe('在 worker 层加重试队列');
    expect(c.files).toEqual(['apps/api/src/worker/retry.ts']);
    expect(c.tests).toEqual(['集成测试: 失败任务进队列并重试']);
    expect(c.risk).toBe('重试风暴需限流');
    expect(c._fallback).toBeFalsy();
  });

  it('steer 注入: 主理人方向文本必须进入发给 LLM 的 prompt', async () => {
    const fetchMock = vi.fn(async () =>
      llmResponse({ approach: 'a', files: ['f'], tests: ['t'], risk: 'r' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const task = { id: 'task-7', title: '加缓存', description: '慢' };
    const steer = '必须用服务端 Redis,别用前端';
    await proposeContract(task, steer);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string);
    const allText = body.messages.map((m: any) => m.content).join('\n');
    expect(allText).toContain(steer);
    // task 信息也应在 prompt 里
    expect(allText).toContain('加缓存');
  });

  it('降级: callLLM 抛错(模拟上游 502) → 返回模板骨架且 _fallback=true,不抛', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, text: async () => 'bad gateway', json: async () => ({}) })),
    );
    const task = { id: 'task-99', title: '某个逻辑活', description: 'xx' };
    const c = await proposeContract(task);
    expect(c._fallback).toBe(true);
    expect(c.approach).toContain('某个逻辑活'); // 模板骨架引用了 title
    expect(Array.isArray(c.files)).toBe(true);
    expect(Array.isArray(c.tests)).toBe(true);
    expect(typeof c.risk).toBe('string');
  });

  it('脏输出: LLM 返回非 JSON 文本 → 降级 _fallback=true,不崩', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse('这不是 JSON,只是一段闲聊')));
    const task = { id: 'task-100', title: '解析脏输出', description: 'yy' };
    const c = await proposeContract(task);
    expect(c._fallback).toBe(true);
    expect(c.approach).toContain('解析脏输出');
  });

  it('脏输出: LLM 返回 JSON 但缺字段 → 降级 _fallback=true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse({ approach: '只有这一个字段' })));
    const task = { id: 'task-101', title: '缺字段', description: 'zz' };
    const c = await proposeContract(task);
    expect(c._fallback).toBe(true);
  });

  it('容错解析: LLM 在 JSON 外包了 markdown 代码块 → 仍能抽出 JSON', async () => {
    const wrapped =
      '好的,这是方案:\n```json\n' +
      JSON.stringify({ approach: 'wrapped', files: ['f'], tests: ['t'], risk: 'r' }) +
      '\n```\n以上。';
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse(wrapped)));
    const task = { id: 'task-102', title: '包裹的 json', description: 'ww' };
    const c = await proposeContract(task);
    expect(c.approach).toBe('wrapped');
    expect(c._fallback).toBeFalsy();
  });

  it('无 API key → 降级 _fallback=true,不抛', async () => {
    delete process.env.OPENROUTER_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse({ approach: 'x', files: ['f'], tests: ['t'], risk: 'r' })));
    const task = { id: 'task-103', title: '没 key', description: 'nk' };
    const c = await proposeContract(task);
    expect(c._fallback).toBe(true);
  });
});

describe('renderContract — 格式保持不变', () => {
  it('渲染输出含全部字段且结构稳定', () => {
    const task = { id: 't', title: '某活' };
    const c = { approach: 'A', files: ['x.ts', 'y.ts'], tests: ['t1', 't2'], risk: 'R' };
    const out = renderContract(task, c, 2);
    expect(out).toContain('方向闸 · 第 2 版 Contract');
    expect(out).toContain('活: 某活');
    expect(out).toContain('打算怎么做: A');
    expect(out).toContain('动哪些文件: x.ts, y.ts');
    expect(out).toContain('怎么验:     t1; t2');
    expect(out).toContain('已知风险:   R');
    expect(out).toContain('[approve]');
    expect(out).toContain('redirect');
  });
});
