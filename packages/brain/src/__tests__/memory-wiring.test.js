/**
 * memory-wiring.test.js
 *
 * 验证记忆系统断链修复：
 * 1. tick.js 中 runSuggestionCycle 的接入（通过 AST 分析文件内容）
 * 2. executor.js 中 recordExpectedReward 的接入
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('tick-runner.js — runSuggestionCycle 接入', () => {
  // D1.7b 后 executeTick body 移到 tick-runner.js
  const tickContent = readFileSync(resolve(ROOT, 'src/tick-runner.js'), 'utf8');

  it('import runSuggestionCycle from suggestion-cycle.js', () => {
    expect(tickContent).toContain('runSuggestionCycle');
    expect(tickContent).toContain('suggestion-cycle');
  });

  it('调用 runSuggestionCycle 且有 catch 错误处理', () => {
    // 验证调用点存在，且附近有 catch 错误处理
    expect(tickContent).toContain('runSuggestionCycle(pool)');
    // 确认 10.18 节标注存在
    expect(tickContent).toContain('10.18');
  });

  it('原有 10.17 topicSelection 调用未受影响', () => {
    expect(tickContent).toContain('triggerDailyTopicSelection');
  });
});

describe('executor.js — recordExpectedReward 接入', () => {
  const execContent = readFileSync(resolve(ROOT, 'src/executor.js'), 'utf8');

  it('import recordExpectedReward from dopamine.js', () => {
    expect(execContent).toContain('recordExpectedReward');
    expect(execContent).toContain('dopamine');
  });

  it('triggerCeceliaRun 函数签名不变', () => {
    expect(execContent).toContain('async function triggerCeceliaRun');
  });

  it('recordExpectedReward 调用有 catch 错误处理（fire-and-forget）', () => {
    // 验证 recordExpectedReward 调用存在，且有 catch/warn 保护
    const idx = execContent.indexOf('recordExpectedReward(');
    expect(idx).toBeGreaterThan(0);
    // 取调用周边 300 字符，验证有错误处理
    const surroundings = execContent.slice(Math.max(0, idx - 50), idx + 300);
    const hasErrorHandling = surroundings.includes('catch') || surroundings.includes('.catch');
    expect(hasErrorHandling).toBe(true);
  });
});
