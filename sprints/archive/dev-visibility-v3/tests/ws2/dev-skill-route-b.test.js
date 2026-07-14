import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const DEV_SKILL = 'packages/workflows/skills/dev/SKILL.md';

describe('WS2 — dev SKILL.md Route B [BEHAVIOR]', () => {
  it('SKILL.md 含 Route B 段落文字', () => {
    const c = readFileSync(DEV_SKILL, 'utf8');
    expect(c).toContain('Route B');
  });

  it('Route B 段落含 Brain POST 端点 localhost:5221/api/brain/tasks', () => {
    const c = readFileSync(DEV_SKILL, 'utf8');
    expect(c).toContain('localhost:5221/api/brain/tasks');
  });

  it('Route B 段落含 task_type 字段', () => {
    const c = readFileSync(DEV_SKILL, 'utf8');
    expect(c).toContain('task_type');
  });

  it('Route A --task-id 路径保持不变', () => {
    const c = readFileSync(DEV_SKILL, 'utf8');
    expect(c).toContain('--task-id');
  });

  it('Route B 含 Brain 离线降级说明（warn 或不阻断）', () => {
    const c = readFileSync(DEV_SKILL, 'utf8');
    const hasDegradation = c.includes('warn') || c.includes('不阻断') || c.includes('offline') || c.includes('离线');
    expect(hasDegradation).toBe(true);
  });
});
