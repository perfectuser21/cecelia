/**
 * W2 — RetryPolicy 集成测试
 *
 * 验证 packages/brain/src/workflows/retry-policies.js 三个 policy（LLM_RETRY/DB_RETRY/NO_RETRY）
 * 在真实 LangGraph StateGraph 上对瞬时/永久错误的行为分别符合预期。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W2
 */
import { describe, it, expect } from 'vitest';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { LLM_RETRY, DB_RETRY, NO_RETRY } from '../../packages/brain/src/workflows/retry-policies.js';

const Anno = Annotation.Root({
  ok: Annotation<boolean>({ reducer: (_o: any, n: any) => n, default: () => false }),
  calls: Annotation<number>({ reducer: (_o: any, n: any) => n, default: () => 0 }),
});

describe('LLM_RETRY policy (W2)', () => {
  it('瞬时错误（network blip） → 重试 3 次后成功', async () => {
    let calls = 0;
    const node = async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNRESET network blip');
      return { ok: true, calls };
    };
    const g = new StateGraph(Anno)
      .addNode('flaky', node, { retryPolicy: LLM_RETRY })
      .addEdge(START, 'flaky')
      .addEdge('flaky', END)
      .compile();
    const out = await g.invoke({});
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
  }, 60000);

  it('永久错误（401 invalid api key） → 不重试，立即抛', async () => {
    let calls = 0;
    const node = async () => {
      calls++;
      throw new Error('HTTP 401 invalid api key');
    };
    const g = new StateGraph(Anno)
      .addNode('auth', node, { retryPolicy: LLM_RETRY })
      .addEdge(START, 'auth')
      .addEdge('auth', END)
      .compile();
    await expect(g.invoke({})).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it('schema parse 错误 → 不重试', async () => {
    let calls = 0;
    const node = async () => {
      calls++;
      throw new Error('schema validation failed: missing required field');
    };
    const g = new StateGraph(Anno)
      .addNode('parse', node, { retryPolicy: LLM_RETRY })
      .addEdge(START, 'parse')
      .addEdge('parse', END)
      .compile();
    await expect(g.invoke({})).rejects.toThrow(/schema/);
    expect(calls).toBe(1);
  });
});

describe('DB_RETRY policy (W2)', () => {
  it('瞬时 DB 错误（connection lost） → 重试 1 次后成功（maxAttempts=2）', async () => {
    let calls = 0;
    const node = async () => {
      calls++;
      if (calls < 2) throw new Error('connection lost during query');
      return { ok: true, calls };
    };
    const g = new StateGraph(Anno)
      .addNode('db', node, { retryPolicy: DB_RETRY })
      .addEdge(START, 'db')
      .addEdge('db', END)
      .compile();
    const out = await g.invoke({});
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
  }, 30000);

  it('UNIQUE constraint 违反 → 不重试', async () => {
    let calls = 0;
    const node = async () => {
      calls++;
      throw new Error('duplicate key value violates UNIQUE constraint "tasks_pkey"');
    };
    const g = new StateGraph(Anno)
      .addNode('upsert', node, { retryPolicy: DB_RETRY })
      .addEdge(START, 'upsert')
      .addEdge('upsert', END)
      .compile();
    await expect(g.invoke({})).rejects.toThrow(/UNIQUE|duplicate/);
    expect(calls).toBe(1);
  });
});

describe('NO_RETRY policy (W2)', () => {
  it('任何错误 → maxAttempts=1，立即抛', async () => {
    let calls = 0;
    const node = async () => {
      calls++;
      throw new Error('anything');
    };
    const g = new StateGraph(Anno)
      .addNode('once', node, { retryPolicy: NO_RETRY })
      .addEdge(START, 'once')
      .addEdge('once', END)
      .compile();
    await expect(g.invoke({})).rejects.toThrow(/anything/);
    expect(calls).toBe(1);
  });
});

describe('retry-policies module exports (W2)', () => {
  it('LLM_RETRY/DB_RETRY/NO_RETRY 三个 policy 导出存在', () => {
    expect(LLM_RETRY).toBeDefined();
    expect(DB_RETRY).toBeDefined();
    expect(NO_RETRY).toBeDefined();
    expect(LLM_RETRY.maxAttempts).toBe(3);
    expect(DB_RETRY.maxAttempts).toBe(2);
    expect(NO_RETRY.maxAttempts).toBe(1);
    expect(typeof LLM_RETRY.retryOn).toBe('function');
    expect(typeof DB_RETRY.retryOn).toBe('function');
  });

  it('LLM_RETRY.retryOn 对 401/schema/parse/AbortError 返回 false', () => {
    expect(LLM_RETRY.retryOn(new Error('HTTP 401 invalid api key'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('schema validation failed'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('parse failed: invalid JSON'))).toBe(false);
    const abortErr = new Error('aborted'); (abortErr as any).name = 'AbortError';
    // retryOn 检查 message — AbortError 用文字判断（spec 把 AbortError 写在 PERMANENT_ERROR_RE 字面量内）
    expect(LLM_RETRY.retryOn({ message: 'AbortError: aborted' })).toBe(false);
  });

  it('LLM_RETRY.retryOn 对瞬时错（503/timeout/network） 返回 true', () => {
    expect(LLM_RETRY.retryOn(new Error('HTTP 503 service unavailable'))).toBe(true);
    expect(LLM_RETRY.retryOn(new Error('ETIMEDOUT'))).toBe(true);
    expect(LLM_RETRY.retryOn(new Error('ECONNRESET network blip'))).toBe(true);
  });
});
