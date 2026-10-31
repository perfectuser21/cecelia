import { describe, it, expect } from 'vitest';
import { runEmbeddingScript } from './helpers/capability-embeddings-harness.js';

const capabilities = [
  { id: 'cap-a', name: '客户接待', description: '识别新客户' },
  { id: 'cap-b', name: '通知', description: null },
  { id: 'cap-c', name: '检索', description: '' },
  { id: 'cap-d', name: '分诊', description: '' },
  { id: 'cap-e', name: '采集', description: '' },
  { id: 'cap-f', name: '发布', description: '' },
];
const failed = () => new Error('embedding service unavailable');

describe('generate-capability-embeddings CLI 的真实执行与资源保护', () => {
  // Removing quota detection must process additional rows and fail these assertions.
  it.each(['OpenAI quota exceeded', 'insufficient_quota', 'quota_exceeded'])(
    '%s 首次出现即失败退出，不调用下一条模型或写入', async message => {
      const calls = await runEmbeddingScript({ capabilities, outcomes: [new Error(message)] });
      expect(calls.exits[0]).toBe(1);
      expect(calls.texts).toEqual(['客户接待\n\n识别新客户']);
      expect(calls.writes).toEqual([]);
    },
  );

  it('三次连续失败后停止，第四条不生成向量', async () => {
    const calls = await runEmbeddingScript({ capabilities, outcomes: [failed(), failed(), failed()] });
    expect(calls.exits[0]).toBe(1);
    expect(calls.texts).toEqual(['客户接待\n\n识别新客户', '通知', '检索']);
    expect(calls.writes).toEqual([]);
  });

  it('成功会重置连续失败计数，并保留失败前后的成功写入', async () => {
    const calls = await runEmbeddingScript({ capabilities, outcomes: [failed(), failed(), [1, 2], failed(), failed(), [3, 4]] });
    expect(calls.texts).toHaveLength(6);
    expect(calls.writes.map(write => write.params)).toEqual([
      ['[1,2]', 'cap-c'], ['[3,4]', 'cap-f'],
    ]);
    // Partial failure remains a failed CLI execution, even after later successes.
    expect(calls.exits[0]).toBe(1);
  });

  it('五分钟边界允许当前条处理，超过后在下一次模型调用前退出', async () => {
    const calls = await runEmbeddingScript({ capabilities, times: [0, 300000, 300001] });
    expect(calls.texts).toEqual(['客户接待\n\n识别新客户']);
    expect(calls.writes.map(write => write.params)).toEqual([['[0.25,-0.5]', 'cap-a']]);
    expect(calls.exits[0]).toBe(1);
  });

  it('全部成功时按 capability id 保存真实模型返回的向量并退出 0', async () => {
    const calls = await runEmbeddingScript({ capabilities: capabilities.slice(0, 2), outcomes: [[0.1, 0.2], [-1, 0]] });
    expect(calls.texts).toEqual(['客户接待\n\n识别新客户', '通知']);
    expect(calls.writes).toEqual([
      { sql: 'UPDATE capabilities_legacy SET embedding = $1::vector WHERE id = $2', params: ['[0.1,0.2]', 'cap-a'] },
      { sql: 'UPDATE capabilities_legacy SET embedding = $1::vector WHERE id = $2', params: ['[-1,0]', 'cap-b'] },
    ]);
    expect(calls.exits[0]).toBe(0);
  });

  it('已有成功写入后连续失败仍保留成功向量，并停止后续条目', async () => {
    const calls = await runEmbeddingScript({ capabilities, outcomes: [[5, 6], failed(), failed(), failed()] });
    expect(calls.writes.map(write => write.params)).toEqual([['[5,6]', 'cap-a']]);
    expect(calls.texts).toHaveLength(4);
    expect(calls.exits[0]).toBe(1);
  });

  it('没有能力记录时不请求模型并释放连接', async () => {
    const calls = await runEmbeddingScript({ capabilities: [] });
    expect(calls.texts).toEqual([]);
    expect(calls.writes).toEqual([]);
    expect(calls.exits).toEqual([]);
    expect(calls.released).toBe(1);
    expect(calls.ended).toBe(1);
  });
});
