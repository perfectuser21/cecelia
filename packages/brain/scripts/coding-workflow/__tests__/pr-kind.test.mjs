// lib/pr-kind.mjs：PR 类型判据。C2b（决策 4fe863c3）加 API 面判定——改了 API 面的 PR 一条回归 smoke 都没固化就拦合并。
import { describe, it, expect } from 'vitest';
import { prKindOf, touchesApiSurface } from '../lib/pr-kind.mjs';

describe('prKindOf', () => {
  it('修复/bug/fix 开头 → fix，否则 feat', () => {
    expect(prKindOf('修复 x')).toBe('fix');
    expect(prKindOf('fix: x')).toBe('fix');
    expect(prKindOf('新增 x')).toBe('feat');
  });
});

describe('touchesApiSurface（PR 是否改了 API 面）', () => {
  it.each([
    ['packages/brain/src/routes/tasks.js'],
    ['packages/brain/src/routes/ops/runs.js'],
    ['packages/brain/src/routes.js'],
    ['packages/brain/src/trace-routes.js'],
    ['packages/brain/src/system-coding-route.js'],
    ['packages/brain/server.js'],
    ['apps/api/src/server.ts'],
  ])('%s → 是', (file) => {
    expect(touchesApiSurface(['README.md', file])).toBe(true);
  });

  it.each([
    ['packages/brain/src/routes/__tests__/tasks.test.js'],
    ['packages/brain/src/routes/activity-judgments.test.js'],
    ['packages/brain/scripts/coding-workflow/runner/lib/qa-gate.mjs'],
    ['apps/dashboard/src/pages/Home.tsx'],
    ['packages/brain/src/tick.js'],
    ['sprints/10120705-cw-aaaaaaaa/02-spec.md'],
  ])('%s（测试 / runner 脚本 / 纯 UI / 非路由）→ 否', (file) => {
    expect(touchesApiSurface([file])).toBe(false);
  });

  it('空列表或非数组 → 否', () => {
    expect(touchesApiSurface([])).toBe(false);
    expect(touchesApiSurface(null)).toBe(false);
  });
});
