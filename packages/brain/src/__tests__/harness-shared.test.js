/**
 * 验证：harness-shared.js export 共享函数（不重新维护无消费者的Protocol-v2桥）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => { vi.stubEnv('CECELIA_SKILLS_ROOT', new URL('./owned-missing-skills', import.meta.url).pathname); });
afterEach(() => vi.unstubAllEnvs());

describe('harness-shared module', () => {
  it('exports parseDockerOutput / extractField / loadSkillContent', async () => {
    const mod = await import('../harness-shared.js');
    expect(typeof mod.parseDockerOutput).toBe('function');
    expect(typeof mod.extractField).toBe('function');
    expect(typeof mod.loadSkillContent).toBe('function');
  });

  it('parseDockerOutput 抽 claude --output-format json 末尾 result 段', async () => {
    const { parseDockerOutput } = await import('../harness-shared.js');
    const stdout = `some preamble\n{"result":"final-output-content","other":"x"}\n`;
    const out = parseDockerOutput(stdout);
    expect(out).toContain('final-output-content');
  });

  it('extractField 兼容 pr_url: <URL> 字面量 + JSON', async () => {
    const { extractField } = await import('../harness-shared.js');
    expect(extractField('pr_url: https://github.com/x/y/pull/1', 'pr_url')).toBe('https://github.com/x/y/pull/1');
    expect(extractField('"pr_url":"https://github.com/x/y/pull/2"', 'pr_url')).toBe('https://github.com/x/y/pull/2');
    expect(extractField('pr_url: null', 'pr_url')).toBeNull();
    expect(extractField('pr_url: FAILED', 'pr_url')).toBeNull();
  });

  it('loadSkillContent 缺文件时 throw（B56 fail-fast，不再返回空串）', async () => {
    // 当前入口只读仓库bundle；本例显式owned不存在路径，不读取个人Skill。
    // 旧行为返回空串会导致 generator 拿空 SKILL prompt 跑出无 PR 的假成功，故 fail-fast。
    const { loadSkillContent } = await import('../harness-shared.js');
    expect(() => loadSkillContent('nonexistent-skill-name-xyz-b56')).toThrow(/SKILL\.md not found/);
  });

});

