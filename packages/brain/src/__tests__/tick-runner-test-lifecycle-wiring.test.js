import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('tick-runner — 10.24 test 生命周期巡检挂载', () => {
  it('import 语句存在', () => {
    const src = fs.readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf-8');
    expect(src).toContain("import { runTestLifecyclePatrol, isInPatrolWindow as isInTestLifecyclePatrolWindow } from './test-lifecycle-patrol.js';");
  });

  it('10.24 挂载点保留窗口判断、fire-and-forget + catch', () => {
    const src = fs.readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf-8');
    const idx24 = src.indexOf('10.24 test 生命周期巡检');
    expect(idx24).toBeGreaterThan(-1);
    expect(src).toContain('if (isInTestLifecyclePatrolWindow(now))');
    expect(src).toContain('runTestLifecyclePatrol(pool)');
    expect(src).toContain("catch(e => console.warn('[tick] test 生命周期巡检失败:', e.message))");
  });
});
