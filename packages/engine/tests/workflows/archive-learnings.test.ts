import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOW_PATH = join(__dirname, '../../../../.github/workflows/archive-learnings.yml');

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

test('workflow 有 monthly cron schedule', () => {
  const c = readWorkflow();
  expect(c).toMatch(/cron:\s*['"]0 4 1 \* \*['"]/);
});

test('workflow 支持 workflow_dispatch 手动触发', () => {
  const c = readWorkflow();
  expect(c).toContain('workflow_dispatch:');
});

test('workflow 有 contents: write 权限（commit 推 main 需要）', () => {
  const c = readWorkflow();
  expect(c).toMatch(/permissions:\s*[\s\S]*?contents:\s*write/);
});

test('用 git log --diff-filter=A 拿首次入库时间（不依赖 mtime）', () => {
  const c = readWorkflow();
  expect(c).toContain('git log --follow --diff-filter=A --format=%at');
});

test('30 天 cutoff 逻辑存在', () => {
  const c = readWorkflow();
  expect(c).toMatch(/30 days ago/);
});

test('按 YYYY-MM 分桶 tar.gz', () => {
  const c = readWorkflow();
  expect(c).toMatch(/\+%Y-%m/);
  expect(c).toMatch(/tar -czf/);
  expect(c).toMatch(/archive\/\$\{BUCKET\}\.tar\.gz/);
});

test('归档后 git rm 原文件', () => {
  const c = readWorkflow();
  expect(c).toMatch(/git rm/);
});

test('fetch-depth: 0 拿完整 git log', () => {
  const c = readWorkflow();
  expect(c).toMatch(/fetch-depth:\s*0/);
});
