/**
 * WS3 — inbox 合并入 dashboard（分组数缩减至 ≤ 5） [BEHAVIOR] TDD Red 测试
 * Round 2: 只处理 inbox（today 保持独立 'today' 分组，与 WS3 scope 一致）
 * 实现前：inbox 有独立 navGroup id='inbox' → 测试应 RED
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const INBOX = readFileSync(resolve('/workspace/apps/api/features/inbox/index.ts'), 'utf8');

describe('WS3 — inbox 合并入 dashboard [BEHAVIOR]', () => {
  it('inbox navItem.group 已改为 "dashboard"', () => {
    expect(INBOX).toContain("group: 'dashboard'");
  });

  it('inbox 不再独立声明 navGroup id="inbox"', () => {
    expect(INBOX).not.toMatch(/\{\s*id:\s*['"]inbox['"]/);
  });

  it('inbox navGroups 声明已移除或为空数组', () => {
    const navGroupsBlock = INBOX.match(/navGroups:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(navGroupsBlock.trim()).toBe('');
  });

  it('合并后全局 navGroup 唯一 id 数量 ≤ 5（WS1+WS2+WS3 全部完成时）', () => {
    const featuresDir = '/workspace/apps/api/features';
    const dirs = readdirSync(featuresDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const ids = new Set<string>();
    for (const dir of dirs) {
      try {
        const c = readFileSync(resolve(featuresDir, dir, 'index.ts'), 'utf8');
        // 只从 navGroups: [ ... ] 块中提取 id（避免 routes 中的 path id 干扰计数）
        const navGroupBlocks = [...c.matchAll(/navGroups:\s*\[([\s\S]*?)\]/g)];
        for (const block of navGroupBlocks) {
          const idMatches = [...block[1].matchAll(/id:\s*['"](\w[\w-]*)['"](\s*,)?/g)];
          for (const m of idMatches) {
            ids.add(m[1]);
          }
        }
      } catch {}
    }
    // 预期：dashboard + today + gtd + knowledge-docs + system = 5
    expect(ids.size).toBeLessThanOrEqual(5);
  });

  it('id="inbox" 不在任何 feature manifest 的 navGroups 中出现', () => {
    const featuresDir = '/workspace/apps/api/features';
    const dirs = readdirSync(featuresDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      try {
        const c = readFileSync(resolve(featuresDir, dir, 'index.ts'), 'utf8');
        const navGroupBlocks = [...c.matchAll(/navGroups:\s*\[([\s\S]*?)\]/g)];
        for (const block of navGroupBlocks) {
          expect(block[1]).not.toMatch(/id:\s*['"]inbox['"]/);
        }
      } catch {}
    }
  });
});
