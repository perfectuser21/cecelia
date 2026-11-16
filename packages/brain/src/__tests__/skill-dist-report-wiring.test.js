// 真实skill分发漂移job注册护栏；定时晨报/日报生成出口已退役。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const here = dirname(fileURLToPath(import.meta.url));

describe('scheduler 注册', () => {
  it('JOBS 含 skill-dist-drift：needsPool、显式 timeout、在 scheduler-liveness 之前', () => {
    const src = readFileSync(resolve(here, '../scheduler-jobs.js'), 'utf8');
    expect(src).toContain("import { runSkillDistDrift } from './skill-dist-drift.js'");
    const iJob = src.indexOf("name: 'skill-dist-drift'");
    const iLiveness = src.indexOf("name: 'scheduler-liveness'");
    expect(iJob).toBeGreaterThan(0);
    expect(iJob).toBeLessThan(iLiveness);
    const line = src.slice(iJob, src.indexOf('\n', iJob));
    expect(line).toMatch(/needsPool: true/);
    expect(line).toMatch(/timeoutMs: 120_000/);
    expect(line).toMatch(/runSkillDistDrift\(pool\)/);
  });
});
