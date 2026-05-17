import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOW_PATH = join(__dirname, '../../../../.github/workflows/cleanup-merged-artifacts.yml');

function extractRegex(): string {
  const content = readFileSync(WORKFLOW_PATH, 'utf8');
  const m = content.match(/git ls-files \| grep\s+-E\s+["']([^"']+)["']/);
  if (!m) throw new Error('no "git ls-files | grep -E" pattern found in workflow');
  return m[1];
}

function matches(regex: string, filename: string): boolean {
  return new RegExp(regex).test(filename);
}

test('cleanup regex 匹配新命名 DoD.cp-*.md', () => {
  const re = extractRegex();
  expect(matches(re, 'DoD.cp-04050716-448791a8.md')).toBe(true);
});

test('cleanup regex 匹配新命名 PRD.cp-*.md', () => {
  const re = extractRegex();
  expect(matches(re, 'PRD.cp-04131520-langgraph-harness.md')).toBe(true);
});

test('cleanup regex 匹配新命名 TASK_CARD.cp-*.md', () => {
  const re = extractRegex();
  expect(matches(re, 'TASK_CARD.cp-04050413-88c13be1.md')).toBe(true);
});

test('cleanup regex 向后兼容旧命名 .prd-*', () => {
  const re = extractRegex();
  expect(matches(re, '.prd-old-task.md')).toBe(true);
});

test('cleanup regex 向后兼容旧命名 .task-*', () => {
  const re = extractRegex();
  expect(matches(re, '.task-old-task.md')).toBe(true);
});

// Phase 7.5: 补齐 .dod- 前缀匹配，之前漏抓导致 3 个 .dod-cp-* 残留积累
test('cleanup regex 向后兼容旧命名 .dod-*（Phase 7.5 修）', () => {
  const re = extractRegex();
  expect(matches(re, '.dod-cp-04052034-probe-rollback-trigger.md')).toBe(true);
});

test('cleanup regex 不误匹配活跃文件 DoD.md', () => {
  const re = extractRegex();
  expect(matches(re, 'DoD.md')).toBe(false);
});

test('cleanup regex 不误匹配活跃文件 PRD.md', () => {
  const re = extractRegex();
  expect(matches(re, 'PRD.md')).toBe(false);
});

test('cleanup regex 不误匹配 README.md', () => {
  const re = extractRegex();
  expect(matches(re, 'README.md')).toBe(false);
});

test('cleanup regex 不误匹配 DEFINITION.md', () => {
  const re = extractRegex();
  expect(matches(re, 'DEFINITION.md')).toBe(false);
});
