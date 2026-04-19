import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('00.7-decision-query.md 行为规则', () => {
  const STEP_PATH = join(process.cwd(), 'skills/dev/steps/00.7-decision-query.md');
  const content = readFileSync(STEP_PATH, 'utf8');

  it('Phase 1 Round 2 起默认激活（不再有 autonomous_mode 门禁）', () => {
    // 14.17.8 统一后删除了 AUTONOMOUS_MODE exit 0 门禁
    expect(content).not.toMatch(/AUTONOMOUS_MODE.*!=.*true.*exit 0/);
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

  it('critical 缺失时创 Brain task', () => {
    expect(content).toMatch(/Brain task|decision_needed/);
  });
});
