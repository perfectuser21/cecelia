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

test('旧开发流程明确历史身份并路由至已安装中央dev，保留历史流程正文', () => {
  const doc = read('docs/current/DEV_PIPELINE.md');
  assert.match(doc, /^authority: HISTORICAL_SNAPSHOT$/m);
  const introduction = doc.slice(0, doc.indexOf('## 核心原则'));
  assert.match(introduction, /历史/);
  assert.doesNotMatch(introduction, /Authority: CURRENT_STATE|当前事实版|只记录当前真实生效/);
  assert.match(introduction, /已安装的 `dev` 技能/);
  assert.match(introduction, /perfectuser21\/zenithjoy-skills/);
  assert.match(introduction, /\.skills-source\.json/);
  assert.match(doc, /## 12 步流程/);
  assert.match(doc, /### Step 00 — Worktree 检测/);
  assert.match(doc, /### Step 06 — 写代码/);
});
