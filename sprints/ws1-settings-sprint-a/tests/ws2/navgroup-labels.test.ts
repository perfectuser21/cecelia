/**
 * WS2 — navGroup 标签英文化 + cecelia/execution/knowledge 归并 [BEHAVIOR] TDD Red 测试
 * Round 2 修正: execution → group 'system'（非 'work'）；新增 knowledge '知识库'→'Knowledge'；
 *               cecelia 移除 navGroups 声明；新增 requireSuperAdmin 保留验证
 * 实现前：knowledge='知识库', execution='执行', cecelia id='cecelia' → 测试应 RED
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const KNOWLEDGE = readFileSync(resolve('/workspace/apps/api/features/knowledge/index.ts'), 'utf8');
const EXEC = readFileSync(resolve('/workspace/apps/api/features/execution/index.ts'), 'utf8');
const CECELIA = readFileSync(resolve('/workspace/apps/api/features/cecelia/index.ts'), 'utf8');
const NAV_CONFIG = readFileSync(
  resolve('/workspace/apps/dashboard/src/config/navigation.config.ts'), 'utf8'
);

describe('WS2 — navGroup 标签英文化 + 归并 [BEHAVIOR]', () => {
  it('knowledge navGroup label 已改为英文 "Knowledge"', () => {
    expect(KNOWLEDGE).toContain("label: 'Knowledge'");
  });

  it('knowledge navGroup 不再含中文 "知识库"（navGroups 声明内）', () => {
    const navGroupsBlock = KNOWLEDGE.match(/navGroups:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(navGroupsBlock).not.toContain('知识库');
  });

  it('cecelia navGroups 声明已移除（不含有效 id 的 navGroup）', () => {
    const navGroupsBlock = CECELIA.match(/navGroups:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(navGroupsBlock.trim()).toBe('');
  });

  it('cecelia navItem.group 已改为 "system"（归入 System 分组）', () => {
    expect(CECELIA).toContain("group: 'system'");
  });

  it('cecelia 不再独立声明 navGroup id="cecelia"', () => {
    expect(CECELIA).not.toMatch(/\{\s*id:\s*['"]cecelia['"]/);
  });

  it('execution navGroup 中文 label "执行" 已消失（navGroups 声明内）', () => {
    const navGroupsBlock = EXEC.match(/navGroups:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(navGroupsBlock).not.toContain('执行');
  });

  it('execution 不再独立声明 navGroup id="execution"', () => {
    expect(EXEC).not.toMatch(/\{\s*id:\s*['"]execution['"]/);
  });

  it('execution navItem.group 已改为 "system"（归入 System 分组）', () => {
    expect(EXEC).toContain("group: 'system'");
  });

  it('requireSuperAdmin 过滤逻辑已保留于 filterNavGroups（不被 refactor 误删）', () => {
    expect(NAV_CONFIG).toContain('requireSuperAdmin');
    // 确认是在过滤逻辑中使用
    expect(NAV_CONFIG).toMatch(/requireSuperAdmin.*isSuperAdmin|isSuperAdmin.*requireSuperAdmin/s);
  });
});
