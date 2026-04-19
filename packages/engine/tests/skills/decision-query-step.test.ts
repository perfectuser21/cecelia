import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('engine-decision SKILL.md 行为规则（Phase 5 迁移自 00.7-decision-query.md）', () => {
  const STEP_PATH = join(process.cwd(), 'skills/engine-decision/SKILL.md');
  const content = readFileSync(STEP_PATH, 'utf8');

  it('Phase 1 Round 2 起默认激活（不再有 autonomous_mode 门禁）', () => {
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
