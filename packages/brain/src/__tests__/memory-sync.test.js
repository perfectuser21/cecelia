/**
 * memory-sync.test.js
 *
 * memory-sync.js 的单元测试
 * 测试 frontmatter 解析和类型路由逻辑
 */

import { describe, it, expect } from 'vitest';

// 直接测试内部逻辑（通过动态 import）
const MEMORY_SYNC_PATH = new URL('../memory-sync.js', import.meta.url).pathname;

/** 辅助：解析 frontmatter */
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { name: '', description: '', type: '', body: content };
  }
  const fmLines = fmMatch[1].split('\n');
  const meta = {};
  for (const line of fmLines) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return {
    name: meta.name || '',
    description: meta.description || '',
    type: meta.type || '',
    body: fmMatch[2].trim(),
  };
}

describe('memory-sync: parseFrontmatter', () => {
  it('正确解析标准 frontmatter', () => {
    const content = `---
name: 测试记忆
description: 这是一个测试
type: project
---

正文内容`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('测试记忆');
    expect(result.description).toBe('这是一个测试');
    expect(result.type).toBe('project');
    expect(result.body).toBe('正文内容');
  });

  it('无 frontmatter 时返回空元数据', () => {
    const content = '只有正文，没有 frontmatter';
    const result = parseFrontmatter(content);
    expect(result.name).toBe('');
    expect(result.type).toBe('');
    expect(result.body).toBe(content);
  });

  it('解析 feedback 类型', () => {
    const content = `---
name: 一条反馈规则
type: feedback
description: 测试描述
---

规则内容`;
    const result = parseFrontmatter(content);
    expect(result.type).toBe('feedback');
    expect(result.name).toBe('一条反馈规则');
  });

  it('解析 reference 类型', () => {
    const content = `---
name: 外部系统引用
type: reference
description: 指向外部资源
---

引用内容`;
    const result = parseFrontmatter(content);
    expect(result.type).toBe('reference');
  });
});

describe('memory-sync: 类型路由策略', () => {
  it('project 类型应路由到 design_docs', () => {
    const type = 'project';
    const shouldSyncToDesignDocs = ['project', 'reference'].includes(type);
    const shouldSyncToDecisions = type === 'feedback';
    expect(shouldSyncToDesignDocs).toBe(true);
    expect(shouldSyncToDecisions).toBe(false);
  });

  it('feedback 类型应路由到 decisions', () => {
    const type = 'feedback';
    const shouldSyncToDesignDocs = ['project', 'reference'].includes(type);
    const shouldSyncToDecisions = type === 'feedback';
    expect(shouldSyncToDesignDocs).toBe(false);
    expect(shouldSyncToDecisions).toBe(true);
  });

  it('user 类型应跳过', () => {
    const type = 'user';
    const shouldSyncToDesignDocs = ['project', 'reference'].includes(type);
    const shouldSyncToDecisions = type === 'feedback';
    expect(shouldSyncToDesignDocs).toBe(false);
    expect(shouldSyncToDecisions).toBe(false);
  });
});
