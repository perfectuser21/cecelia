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

  it('loadSkillContent 返回字符串（缺文件时返回空字符串而非抛错）', async () => {
    const { loadSkillContent } = await import('../harness-shared.js');
    // 不依赖宿主机 skill 文件存在；只验证 signature + 不抛错（CI 环境无 ~/.claude-account*/skills/）
    const content = loadSkillContent('nonexistent-skill-name-xyz');
    expect(typeof content).toBe('string');
    // 缺文件时 loadSkillContent 应返回 '' 而非抛错，证明 signature 正确
  });
});
