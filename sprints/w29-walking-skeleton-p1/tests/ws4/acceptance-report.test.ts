import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const REPORT = 'sprints/w29-walking-skeleton-p1/acceptance-report.md';

describe('Workstream 4 — acceptance report [BEHAVIOR]', () => {
  it('报告文件存在', () => {
    expect(existsSync(REPORT)).toBe(true);
  });

  it('报告标题含 W29 + Walking Skeleton P1', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/W29/);
    expect(c).toMatch(/Walking Skeleton P1/);
  });

  it('报告覆盖 B1–B7 全部 7 项', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const b of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) {
      expect(c, `report missing ${b}`).toContain(b);
    }
  });

  it('报告引用 walking-skeleton-p1-acceptance-smoke.sh 文件', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain('walking-skeleton-p1-acceptance-smoke');
  });

  it('报告说明 CI 集成方式（real-env-smoke 自动 glob 包含）', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/real-env-smoke|glob.*smoke|自动包含|自动 glob/);
  });

  it('报告含终验 PASS 信号字符串', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain('PASS — 7 项 P1 修复全链路联调通过');
  });

  it('报告含 Step 号映射（Step 1-8 至少出现 1 次）', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/Step\s+[1-8]/);
  });
});
