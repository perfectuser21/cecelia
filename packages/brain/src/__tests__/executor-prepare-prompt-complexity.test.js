/**
 * executor-prepare-prompt-complexity.test.js
 *
 * 复杂度回归测试：确保 preparePrompt 圈复杂度持续低于阈值 10。
 *
 * 背景：Brain 复杂度扫描器发现 preparePrompt 原始 CC=77，经两轮重构降至 CC=6。
 * 本测试防止日后改动造成复杂度反弹（回归保护）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const executorSrc = readFileSync(join(__dirname, '../executor.js'), 'utf8');

const CC_THRESHOLD = 10;

function countBranches(body) {
  const patterns = [
    /\bif\b/g,
    /\bwhile\b/g,
    /\bfor\b/g,
    /\bswitch\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /&&/g,
    /\|\|/g,
    /\?[^:]+:/g,
  ];
  return patterns.reduce((n, re) => n + (executorSrc.match(re.source) || []).length, 0);
}

function extractFunctionBody(src, pattern) {
  const match = pattern.exec(src);
  if (!match) return null;
  const braceStart = src.indexOf('{', match.index);
  if (braceStart === -1) return null;
  let depth = 0, end = braceStart;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(braceStart, end);
}

function calcCC(body) {
  const patterns = [/\bif\b/g, /\bwhile\b/g, /\bfor\b/g, /\bswitch\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?[^:]+:/g];
  const branches = patterns.reduce((n, re) => n + (body.match(re) || []).length, 0);
  return branches + 1;
}

describe('preparePrompt 圈复杂度回归测试', () => {
  it(`preparePrompt 圈复杂度应低于 ${CC_THRESHOLD}`, () => {
    const body = extractFunctionBody(executorSrc, /async function preparePrompt\(task\)/g);
    expect(body).not.toBeNull();
    const cc = calcCC(body);
    expect(cc).toBeLessThan(CC_THRESHOLD);
  });

  it('preparePrompt 使用模块级路由表 _TASK_ROUTES（避免内联 lambda ||）', () => {
    expect(executorSrc).toContain('const _TASK_ROUTES = {');
    expect(executorSrc).toContain('_TASK_ROUTES[taskType]');
  });

  it('preparePrompt 使用 Set 常量替代 || 条件链', () => {
    expect(executorSrc).toContain('const _DECOMP_TYPES =');
    expect(executorSrc).toContain('const _HARNESS_GENERATE_TYPES =');
  });

  it('_isSprintOrHarnessDevMode 辅助函数已提取', () => {
    expect(executorSrc).toContain('function _isSprintOrHarnessDevMode(');
  });
});
