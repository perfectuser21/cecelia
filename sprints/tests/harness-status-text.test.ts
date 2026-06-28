/**
 * TDD Red — Dashboard 首页固定状态标识文字
 * 验证 App.tsx 包含 "Cecelia Harness 工厂线已贯通" 硬编码文字
 * 实现前：App.tsx 无该文字 → 测试应 RED
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const APP_TSX = resolve('/workspace/apps/dashboard/src/App.tsx');
const content = readFileSync(APP_TSX, 'utf8');

describe('Dashboard 首页固定状态标识文字 [BEHAVIOR]', () => {
  it('App.tsx 包含固定文字 "Cecelia Harness 工厂线已贯通"', () => {
    expect(content).toContain('Cecelia Harness 工厂线已贯通');
  });

  it('含 data-testid="harness-status-banner" 属性（供 Playwright 定位）', () => {
    expect(content).toContain('data-testid="harness-status-banner"');
  });

  it('文字位于 AppContent 函数内（主布局区域）', () => {
    const appContentStart = content.indexOf('function AppContent');
    const bannerIdx = content.indexOf('harness-status-banner');
    expect(appContentStart).toBeGreaterThan(-1);
    expect(bannerIdx).toBeGreaterThan(appContentStart);
  });

  it('文字附近无动态 API 依赖（纯静态渲染）', () => {
    const bannerIdx = content.indexOf('harness-status-banner');
    expect(bannerIdx).toBeGreaterThan(-1); // 未实现时强制 RED，不允许 skip
    const ctx = content.slice(Math.max(0, bannerIdx - 100), bannerIdx + 200);
    expect(ctx).not.toMatch(/useState.*工厂线|useEffect.*工厂线|fetch.*工厂线/);
  });
});
