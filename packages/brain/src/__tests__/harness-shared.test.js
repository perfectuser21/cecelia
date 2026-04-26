/**
 * 验证：harness-shared.js export 3 个共享函数（搬自 harness-graph.js）。
 * 函数语义不变，仅 module 路径切换。
 */
import { describe, it, expect } from 'vitest';

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

  it('loadSkillContent 读 skill 文件返回字符串', async () => {
    const { loadSkillContent } = await import('../harness-shared.js');
    // 选个稳定存在的 skill，与 harness-graph.js:46 实现一致
    const content = loadSkillContent('harness-planner');
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });
});
