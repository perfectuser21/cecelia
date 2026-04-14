import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('00.7-decision-query.md 行为规则', () => {
  const STEP_PATH = join(process.cwd(), 'skills/dev/steps/00.7-decision-query.md');
  const content = readFileSync(STEP_PATH, 'utf8');

  it('仅 autonomous_mode 激活', () => {
    expect(content).toMatch(/AUTONOMOUS_MODE.*!=.*true.*exit 0/);
  });

  it('引用 Brain API', () => {
    expect(content).toContain('/api/brain/decisions/match');
  });

  it('输出 .decisions-<branch>.yaml', () => {
    expect(content).toContain('.decisions-');
    expect(content).toContain('.yaml');
  });

  it('区分 matched / missing_critical / missing_routine', () => {
    expect(content).toContain('matched');
    expect(content).toContain('missing_critical');
    expect(content).toContain('missing_routine');
  });

  it('critical 缺失时暂停 autonomous 创 Brain task', () => {
    expect(content).toMatch(/暂停.*autonomous|Brain task/);
  });
});
