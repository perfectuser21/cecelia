import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';
import { join } from 'path';

const ENGINE_DIR = join(__dirname, '../..');
const SPEC_FILE = join(ENGINE_DIR, 'skills/dev/steps/01-spec.md');
const PLANNER_PROMPT = join(ENGINE_DIR, 'skills/dev/lib/planner-prompt.md');

describe('Planner subagent — Stage 1 拆分', () => {
  it('01-spec.md 版本升级到 3.0.0', () => {
    const content = readFileSync(SPEC_FILE, 'utf8');
    expect(content).toContain('3.0.0');
  });

  it('01-spec.md 包含 Planner subagent spawn 说明', () => {
    const content = readFileSync(SPEC_FILE, 'utf8');
    expect(content).toContain('Planner subagent');
    expect(content).toContain('spawn Planner subagent');
  });

  it('01-spec.md 包含 SYSTEM_MAP 隔离规则', () => {
    const content = readFileSync(SPEC_FILE, 'utf8');
    expect(content).toContain('SYSTEM_MAP');
    expect(content).toContain('禁止传入');
  });

  it('01-spec.md Sprint Contract Gate 机制完整保留', () => {
    const content = readFileSync(SPEC_FILE, 'utf8');
    expect(content).toContain('Sprint Contract Gate');
  });

  it('planner-prompt.md 文件存在', () => {
    expect(() => accessSync(PLANNER_PROMPT)).not.toThrow();
  });

  it('planner-prompt.md 明确区分 WHAT 和 HOW', () => {
    const content = readFileSync(PLANNER_PROMPT, 'utf8');
    expect(content).toContain('WHAT');
    expect(content).toContain('HOW');
  });

  it('planner-prompt.md 包含隔离规则（禁止 CLAUDE.md）', () => {
    const content = readFileSync(PLANNER_PROMPT, 'utf8');
    expect(content).toContain('禁止');
  });
});
