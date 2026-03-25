/**
 * memory-consolidator-wiring.test.js
 *
 * 验证 runConversationConsolidator 已接入 tick.js（10.19 节）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../..');
const tickContent = readFileSync(resolve(ROOT, 'src/tick.js'), 'utf8');

describe('tick.js — runConversationConsolidator 接入', () => {
  it('import runConversationConsolidator from conversation-consolidator.js', () => {
    expect(tickContent).toContain('runConversationConsolidator');
    expect(tickContent).toContain('conversation-consolidator');
  });

  it('在 10.19 节调用 runConversationConsolidator', () => {
    expect(tickContent).toContain('10.19');
    expect(tickContent).toContain('runConversationConsolidator(');
  });

  it('调用有 catch 错误处理（不阻塞 tick）', () => {
    const idx = tickContent.indexOf('runConversationConsolidator(');
    expect(idx).toBeGreaterThan(0);
    const surroundings = tickContent.slice(Math.max(0, idx - 20), idx + 200);
    expect(surroundings.includes('catch') || surroundings.includes('.catch')).toBe(true);
  });

  it('原有 10.18 runSuggestionCycle 调用未受影响', () => {
    expect(tickContent).toContain('10.18');
    expect(tickContent).toContain('runSuggestionCycle');
  });
});
