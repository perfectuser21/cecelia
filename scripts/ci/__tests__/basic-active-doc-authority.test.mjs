import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('默认自动加载的资料路由不授予直接提交或免dev例外', () => {
  const claude = read('.claude/CLAUDE.md');
  assert.match(claude, /^@docs\/current\/README\.md$/m);
  const route = read('docs/current/README.md');
  assert.doesNotMatch(route, /不需要\s*\/dev|直接改直接\s*commit/);
  assert.match(route, /文档改动.*\/dev.*PR/);
});

test('活动路由忠实标注系统地图自身的历史身份', () => {
  assert.match(read('docs/current/SYSTEM_MAP.md'), /^authority: HISTORICAL_SNAPSHOT$/m);
  const row = read('docs/current/README.md').split('\n')
    .find(line => line.startsWith('| 整体架构、子系统关系 |'));
  assert.ok(row, '实际路由表必须保留系统地图入口');
  assert.match(row, /历史/);
  assert.doesNotMatch(row, /权威|每10个PR/);
});
