/**
 * WS3 Red Tests — packages/engine/skills/harness-intervention/SKILL.md
 * 在 WS3 实现前，以下测试必须全部 FAIL（文件不存在 → readFileSync throw）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SKILL_MD_PATH = resolve(
  process.cwd(),
  'packages/engine/skills/harness-intervention/SKILL.md'
);

function getSkillContent(): string {
  return readFileSync(SKILL_MD_PATH, 'utf8');
}

describe('WS3 — harness-intervention SKILL.md 结构验证 [BEHAVIOR]', () => {
  it('SKILL.md 文件存在', () => {
    expect(() => getSkillContent()).not.toThrow();
  });

  it('包含 docker logs 读取步骤（--tail 200）', () => {
    const src = getSkillContent();
    expect(src).toContain('docker logs');
  });

  it('包含三类卡死类型：CI 未触发 / PR 未推 / Brain 状态', () => {
    const src = getSkillContent();
    expect(src).toContain('CI 未触发');
    expect(src).toContain('PR 未推');
    expect(src).toContain('Brain 状态');
  });

  it('包含 checkpoint 读取步骤', () => {
    const src = getSkillContent();
    expect(src).toContain('checkpoint');
  });

  it('包含 sprint 合同文件读取步骤（contract）', () => {
    const src = getSkillContent();
    expect(src).toContain('contract');
  });

  it('包含 30s 等待验证步骤', () => {
    const src = getSkillContent();
    expect(src).toMatch(/30s|30 秒|30 second/i);
  });

  it('包含 BARK_TOKEN 告警集成', () => {
    const src = getSkillContent();
    expect(src).toContain('BARK_TOKEN');
  });

  it('包含 Brain API 不可达降级描述（5221）', () => {
    const src = getSkillContent();
    expect(src).toMatch(/不可达|unavailable|5221/i);
  });
});
