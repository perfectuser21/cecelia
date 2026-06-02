import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { loadSkillContent } from '../harness-shared.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('B56 loadSkillContent fail-fast', () => {
  it('找不到 SKILL.md（所有路径 miss）→ throw（不返回空串）', () => {
    existsSync.mockReturnValue(false);
    expect(() => loadSkillContent('b56-nonexistent-skill-a')).toThrow(/SKILL\.md not found/);
  });

  it('throw message 含搜索路径（诊断价值）', () => {
    existsSync.mockReturnValue(false);
    expect(() => loadSkillContent('b56-nonexistent-skill-b')).toThrow(/skills/);
  });

  it('失败不缓存：首次 miss throw 后，路径恢复 → 第二次返回内容', () => {
    // 首次全 miss → throw
    existsSync.mockReturnValue(false);
    expect(() => loadSkillContent('b56-recover-skill')).toThrow();
    // 路径恢复
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('RECOVERED SKILL CONTENT');
    expect(loadSkillContent('b56-recover-skill')).toBe('RECOVERED SKILL CONTENT');
  });

  it('成功结果仍缓存：第二次调用不再读文件', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('CACHED SKILL');
    expect(loadSkillContent('b56-cache-skill')).toBe('CACHED SKILL');
    const callsAfterFirst = readFileSync.mock.calls.length;
    expect(loadSkillContent('b56-cache-skill')).toBe('CACHED SKILL');
    // cache hit → readFileSync 调用次数不增加
    expect(readFileSync.mock.calls.length).toBe(callsAfterFirst);
  });
});
