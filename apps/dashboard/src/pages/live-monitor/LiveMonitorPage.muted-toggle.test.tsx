import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * LiveMonitorPage.muted-toggle.test.tsx — grep 级回归防线
 *
 * 不渲染整个 LiveMonitorPage（1700+ 行，mock 成本高）。
 * 用 fs readFileSync + regex 检查 muted toggle 关键行为锚点，
 * 防止"有人误删/重构 toggle 逻辑"这类回归。
 *
 * 不挡"逻辑错误"，只挡"代码被删"。深度验证走 SettingsPage.test.tsx
 * （组件级）+ muted-toggle-e2e.integration.test.js（HTTP 级）。
 */
describe('LiveMonitorPage muted toggle — 静态锚点检查', () => {
  const SRC = readFileSync(
    resolve(__dirname, 'LiveMonitorPage.tsx'),
    'utf8'
  );

  it('含 GET /api/brain/settings/muted（初始加载）', () => {
    expect(SRC).toMatch(/fetch\(['"]\/api\/brain\/settings\/muted['"]\)/);
  });

  it('含 PATCH /api/brain/settings/muted（点击切换）', () => {
    expect(SRC).toMatch(/method:\s*['"]PATCH['"]/);
    expect(SRC).toMatch(/['"]\/api\/brain\/settings\/muted['"][\s\S]*?PATCH|PATCH[\s\S]*?['"]\/api\/brain\/settings\/muted['"]/);
  });

  it('env_override 时 button disabled', () => {
    expect(SRC).toMatch(/env_override/);
    expect(SRC).toMatch(/disabled[\s\S]*?env_override|env_override[\s\S]*?disabled/);
  });

  it("UI 含飞书静默/发送两种状态文案（JSX 三元表达式）", () => {
    // 源码形如：飞书: {muted.enabled ? '静默中' : '发送中'}
    expect(SRC).toContain('飞书:');
    expect(SRC).toContain('静默中');
    expect(SRC).toContain('发送中');
  });

  it('PATCH body 含 JSON.stringify({enabled: ...})', () => {
    expect(SRC).toMatch(/JSON\.stringify\(\s*\{\s*enabled:/);
  });
});
