/**
 * WS1 — Settings 独立 navItem 注册 [BEHAVIOR] TDD Red 测试
 * Round 2: /settings 从 System tab children 移出，成为独立 navItem（label: 'Settings'）
 * 实现前：/settings 仅在 children 数组内（label: '设置'）→ 测试应 RED
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SYSTEM_HUB = resolve('/workspace/apps/api/features/system-hub/index.ts');
const content = readFileSync(SYSTEM_HUB, 'utf8');

describe('WS1 — Settings 独立 navItem 注册 [BEHAVIOR]', () => {
  it('system-hub manifest 包含 /settings 路由', () => {
    expect(content).toMatch(/path:\s*['"]\/settings['"]/);
  });

  it('/settings 路由有独立 navItem（不嵌套在 children 数组内）', () => {
    // 独立路由对象结构: { path: '/settings', component: ..., navItem: { ... } }
    const routeBlock = content.match(/path:\s*['"]\/settings['"][^}]{0,300}navItem\s*:/s);
    expect(routeBlock).not.toBeNull();
  });

  it('Settings navItem label 为英文 "Settings"', () => {
    expect(content).toContain("label: 'Settings'");
  });

  it('中文 label "设置" 已从 manifest 全文移除', () => {
    // 「设置」不应出现在 system-hub（含 children 数组的旧写法）
    expect(content).not.toContain('设置');
  });

  it('Settings navItem.group 指向 "system"（归入 System 分组）', () => {
    // /settings 独立 navItem 内含 group: 'system'
    const hasSystemGroup = /path:\s*['"]\/settings['"][\s\S]{0,400}?group:\s*['"]system['"]/.test(content);
    expect(hasSystemGroup).toBe(true);
  });

  it('SettingsLayout 组件已在 manifest components 注册', () => {
    expect(content).toContain('SettingsLayout');
    expect(content).toMatch(/SettingsLayout:\s*\(\)\s*=>\s*import/);
  });
});
