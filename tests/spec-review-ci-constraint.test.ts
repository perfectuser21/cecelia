import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('spec-review SKILL.md CI 兼容性约束', () => {
  const content = readFileSync('packages/workflows/skills/spec-review/SKILL.md', 'utf8');

  it('包含 CI 兼容性硬约束章节', () => {
    expect(content).toContain('CI 兼容性硬约束');
    expect(content).toContain('只允许以下三种验证形式');
  });

  it('只允许 node -e / curl / tests/*.test.ts', () => {
    expect(content).toContain('node -e');
    expect(content).toContain('curl');
    expect(content).toContain('tests/*.test.ts');
  });

  it('禁止浏览器点击和 UI 交互', () => {
    expect(content).toContain('浏览器点击');
    expect(content).toContain('UI 交互描述');
    expect(content).toContain('人工目视检查');
  });

  it('执行流程包含 CI 兼容性约束提示', () => {
    expect(content).toContain('CI 兼容性约束：只允许 node -e');
    expect(content).toContain('禁止：浏览器点击、UI 交互描述');
  });

  it('一致性判断标准包含 CI 可执行命令要求', () => {
    expect(content).toContain('CI 不可执行的验证形式');
  });
});
