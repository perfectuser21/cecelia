import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';

const SMOKE = 'packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh';

describe('Workstream 1 — smoke harness + happy path (Steps 1-3) [BEHAVIOR]', () => {
  it('smoke 文件存在且可执行', () => {
    expect(existsSync(SMOKE)).toBe(true);
    const mode = statSync(SMOKE).mode;
    expect(mode & 0o111).toBeTruthy();
  });

  it('smoke 顶部含 #!/usr/bin/env bash + set -euo pipefail', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/^#!\/usr\/bin\/env bash/m);
    expect(c).toMatch(/^set -euo pipefail/m);
  });

  it('smoke 含 docker/brain 不可用时的 SKIP 退路', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/SKIP:.*(docker|brain|not available|不可用)/);
  });

  it('smoke 使用 test-w29 隔离前缀便于幂等清理', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('test-w29');
  });

  it('happy path 含 dispatch_events 时间窗口断言（防造假）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/dispatch_events[\s\S]*INTERVAL[\s'"]+[0-9]+[\s'"]*(minute|second)/);
  });

  it('happy path 含 tasks.status = completed 断言（B1 invariant）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/status\s*=\s*'completed'|status=completed|"completed"/);
  });

  it('happy path 含 task_events / task_completed 写入断言', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/task_events[\s\S]*task_completed|event_type\s*=\s*'task_completed'/);
  });
});
