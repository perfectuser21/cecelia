import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('devloop-check.sh: Playwright Evaluator 已移除', () => {
  const filePath = resolve(__dirname, '../../lib/devloop-check.sh');
  const raw = readFileSync(filePath, 'utf8');
  // 排除文件头部 changelog 注释（以 # 开头的连续行），只检查功能代码
  const lines = raw.split('\n');
  const codeStart = lines.findIndex((l, i) => i > 0 && !l.startsWith('#') && l.trim() !== '');
  const content = lines.slice(codeStart).join('\n');

  it('不包含 playwright_evaluator_status 引用', () => {
    expect(content).not.toContain('playwright_evaluator_status');
  });

  it('不包含 .dev-gate-evaluator seal 文件引用', () => {
    expect(content).not.toContain('.dev-gate-evaluator');
  });

  it('不包含 playwright-evaluator.sh 引用', () => {
    expect(content).not.toContain('playwright-evaluator.sh');
  });

  it('不包含 playwright_evaluator 条件检查代码', () => {
    expect(content).not.toContain('playwright_evaluator');
  });
});
