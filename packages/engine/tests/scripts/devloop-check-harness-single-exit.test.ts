import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — harness 单一 exit 0 收敛（v4.6.0）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  it('harness 快速通道内不含 _mark_cleanup_done（PR 创建后不立即退出）', () => {
    const cond05Idx = content.indexOf('===== 条件 0.5');
    const cond1Idx = content.indexOf('===== 条件 1');
    expect(cond05Idx).toBeGreaterThan(-1);
    expect(cond1Idx).toBeGreaterThan(-1);
    const harnessSection = content.substring(cond05Idx, cond1Idx);
    expect(harnessSection).not.toContain('_mark_cleanup_done');
  });

  it('harness 快速通道内不含 return 0（不在 PR 创建时提前退出）', () => {
    const cond05Idx = content.indexOf('===== 条件 0.5');
    const cond1Idx = content.indexOf('===== 条件 1');
    const harnessSection = content.substring(cond05Idx, cond1Idx);
    expect(harnessSection).not.toMatch(/\breturn 0\b/);
  });

  it('条件 2.6 DoD 检查有 _harness_mode 跳过守卫', () => {
    const cond26Idx = content.indexOf('===== 条件 2.6');
    const cond3Idx = content.indexOf('===== 条件 3');
    expect(cond26Idx).toBeGreaterThan(-1);
    const section = content.substring(cond26Idx, cond3Idx);
    expect(section).toContain('_harness_mode');
  });

  it('条件 5（PR merged）有 harness_mode 跳过 step_4_ship 的逻辑', () => {
    const cond5Idx = content.indexOf('===== 条件 5');
    const cond6Idx = content.indexOf('===== 条件 6');
    expect(cond5Idx).toBeGreaterThan(-1);
    const section = content.substring(cond5Idx, cond6Idx);
    expect(section).toContain('_harness_mode');
  });

  it('条件 6（CI 通过→merge）有 harness_mode 跳过 step_4_ship 的逻辑', () => {
    const cond6Idx = content.indexOf('===== 条件 6');
    expect(cond6Idx).toBeGreaterThan(-1);
    const section = content.substring(cond6Idx, cond6Idx + 1500);
    expect(section).toContain('_harness_mode');
  });
});
