import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const REPORT = 'sprints/w29-walking-skeleton-p1/acceptance-report.md';

describe('Workstream 4 — Acceptance report [BEHAVIOR via ARTIFACT shape]', () => {
  it('报告文件存在', () => {
    expect(existsSync(REPORT)).toBe(true);
  });

  it('报告标题含 W29 / Walking Skeleton P1', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/W29|Walking Skeleton P1/);
  });

  it('报告覆盖 B1–B7 全部 7 项修复', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const b of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) {
      expect(c).toContain(b);
    }
  });

  it('报告引用本次整合 smoke 文件路径', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain('walking-skeleton-p1-acceptance-smoke');
  });

  it('报告含 CI 集成方式说明（real-env-smoke + 自动 glob）', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain('real-env-smoke');
    expect(c).toMatch(/glob|自动包含|无需追加/);
  });

  it('报告含整体 PASS 信号字面值', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain('[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过');
  });

  it('报告含 Step 1-8 映射', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const s of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      expect(c).toMatch(new RegExp(`Step\\s+${s}\\b`));
    }
  });

  it('报告含 smoke 输出片段占位（合并 PR 时回填）', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/<smoke 输出>|<待回填>|<TBD>|```/);
  });
});
