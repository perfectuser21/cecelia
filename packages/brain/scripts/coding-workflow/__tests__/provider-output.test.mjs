import { describe, expect, it } from 'vitest';
import { claudeOwnErrorText, sessionCostUsd } from '../lib/provider-output.mjs';
import { productionMatchers } from '../lib/production-targets.mjs';

const jsonl = (...events) => events.map(event => JSON.stringify(event)).join('\n');
describe('共享模型原始输出', () => {
  it('仅进程自身错误进入鉴权分类，业务工具输出不冒充鉴权错误', () => {
    const text = jsonl(
      { type: 'assistant', message: { content: [{ type: 'tool_result', content: 'invalid api key from product' }] } },
      { type: 'result', subtype: 'success', result: 'authentication failed from product' },
      { type: 'error', error: { message: 'actual CLI error' } },
      { type: 'turn.failed', error: { message: 'actual native failure' } },
    );
    expect(claudeOwnErrorText(text)).toBe('actual CLI error\nactual native failure');
  });
  it('保留Claude失败result文本和最后计费值；忽略非JSON日志', () => {
    const text = 'log line\n' + jsonl(
      { type: 'result', subtype: 'error_during_execution', result: 'please run /login', total_cost_usd: 1 },
      { type: 'result', subtype: 'success', total_cost_usd: 2.5 },
    );
    expect(claudeOwnErrorText(text)).toBe('error_during_execution\nplease run /login');
    expect(sessionCostUsd(text)).toBe(2.5);
  });
  it('Codex原始记录未提供美元费用时保持未知', () => {
    expect(sessionCostUsd(jsonl({ type: 'thread.started' }, { type: 'turn.completed', usage: { input_tokens: 1 } }))).toBeNull();
    expect(sessionCostUsd('no billing record')).toBe(0);
  });
});

describe('共享预览桥生产地址限制', () => {
  it('默认限制生产端口、主机和赋值形式', () => {
    const { target, assign } = productionMatchers();
    for (const input of ['http://localhost:5221', '100.79.41.61', 'ssh us-vps']) expect(target.test(input)).toBe(true);
    expect(target.test('http://127.0.0.1:5302')).toBe(false);
    expect(assign.test('B=http://localhost:5221')).toBe(true);
  });
  it('显式租户生产地址替换默认匹配，赋值限制保持生效', () => {
    const { target, assign } = productionMatchers([':5200\\b', '\\bhk-vps\\b']);
    expect(target.test('http://localhost:5200')).toBe(true);
    expect(target.test('http://localhost:5221')).toBe(false);
    expect(assign.test('B=http://hk-vps:5200')).toBe(true);
  });
});
