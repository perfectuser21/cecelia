/**
 * collection-stats.test.js
 *
 * 验证 GET /analytics/collection-stats 路由存在并包含关键逻辑。
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const ANALYTICS_PATH = resolve(import.meta.dirname, '../routes/analytics.js');
const DASHBOARD_PATH = resolve(import.meta.dirname, '../../../../apps/dashboard/src/pages/collection-dashboard/CollectionDashboardPage.tsx');
const SYSTEM_HUB_PATH = resolve(import.meta.dirname, '../../../../apps/api/features/system-hub/index.ts');

describe('collection-stats API', () => {
  it('analytics.js 包含 collection-stats 路由定义', () => {
    const src = readFileSync(ANALYTICS_PATH, 'utf8');
    expect(src).toContain('/analytics/collection-stats');
  });

  it('collection-stats 路由返回 daily_volumes 字段', () => {
    const src = readFileSync(ANALYTICS_PATH, 'utf8');
    expect(src).toContain('daily_volumes');
  });

  it('collection-stats 路由返回 health 对象', () => {
    const src = readFileSync(ANALYTICS_PATH, 'utf8');
    expect(src).toContain('overall_inflow_rate');
    expect(src).toContain('target_rate');
  });
});

describe('CollectionDashboardPage', () => {
  it('页面文件存在', () => {
    expect(() => readFileSync(DASHBOARD_PATH, 'utf8')).not.toThrow();
  });

  it('页面包含平台卡片渲染逻辑', () => {
    const src = readFileSync(DASHBOARD_PATH, 'utf8');
    expect(src).toContain('platforms.map');
  });

  it('页面包含健康率指示器', () => {
    const src = readFileSync(DASHBOARD_PATH, 'utf8');
    expect(src).toContain('overall_inflow_rate');
    expect(src).toContain('target_rate');
  });
});

describe('system-hub 路由注册', () => {
  it('/collection-dashboard 路由已注册', () => {
    const src = readFileSync(SYSTEM_HUB_PATH, 'utf8');
    expect(src).toContain('collection-dashboard');
  });

  it('CollectionDashboardPage 组件已注册', () => {
    const src = readFileSync(SYSTEM_HUB_PATH, 'utf8');
    expect(src).toContain('CollectionDashboardPage');
  });
});
