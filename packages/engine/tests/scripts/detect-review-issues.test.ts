import { test, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

const DETECTOR = join(__dirname, '../../../../scripts/devgate/detect-review-issues.js');

function run(input: string): { exit: number; stderr: string } {
  try {
    execFileSync('node', [DETECTOR], { input, encoding: 'utf8' });
    return { exit: 0, stderr: '' };
  } catch (e: any) {
    return { exit: e.status ?? 1, stderr: e.stderr?.toString() ?? '' };
  }
}

test('真实 🔴 严重问题应 exit 1', () => {
  const input = '- 🔴 **发现严重 SQL 注入风险**：xxx';
  expect(run(input).exit).toBe(1);
});

test('section 格式含"未发现" 应 exit 0', () => {
  const input = '#### 🔴 严重问题\n- 未发现严重问题';
  expect(run(input).exit).toBe(0);
});

test('inline 格式 "未发现严重问题" 应 exit 0', () => {
  const input = '代码审查：未发现严重问题。整体质量良好。';
  expect(run(input).exit).toBe(0);
});

test('"未发现需要标记为🔴的严重问题" 应 exit 0（这是本次修复点）', () => {
  const input = '未发现需要标记为🔴的严重问题，属于正常的文档归档操作。';
  expect(run(input).exit).toBe(0);
});

test('"未发现...严重问题"（中间有字符）应 exit 0', () => {
  const input = '审查：未发现任何需要特别关注的严重问题。';
  expect(run(input).exit).toBe(0);
});

test('"没有发现严重问题" 应 exit 0', () => {
  const input = '代码审查完成，没有发现严重问题。';
  expect(run(input).exit).toBe(0);
});

test('无 🔴 且无"未发现" 应 exit 0（无 flag 即通过）', () => {
  const input = '代码整体质量可以。';
  expect(run(input).exit).toBe(0);
});
