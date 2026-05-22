import { describe, it, expect } from 'vitest';

// 提取 scanSkillDir 的 name 解析逻辑成纯函数测试
describe('scan-skills name 解析', () => {
  function parseName(content, dirName) {
    // 当前 scan-skills.js 只匹配 name:，不认 id:（bug 所在）
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    return nameMatch ? nameMatch[1].trim() : dirName;
  }

  it('识别 name: 字段', () => {
    expect(parseName('---\nname: my-skill\n---', 'dir')).toBe('my-skill');
  });

  it('name: 不存在时 fallback 到 id:', () => {
    expect(parseName('---\nid: harness-planner-skill\n---', 'harness-planner')).toBe('harness-planner-skill');
  });

  it('两者都没有时 fallback 到目录名', () => {
    expect(parseName('---\ndescription: something\n---', 'my-dir')).toBe('my-dir');
  });
});
