/**
 * team-dashboard-routing.test.ts
 * 验证 Dashboard API 路由修复 + content analytics 接入
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../../..');

describe('server.js 路由顺序：brainRoutes 早于 contentPipelineRoutes 通用挂载', () => {
  it('brainRoutes 挂载位置在 contentPipelineRoutes 通用挂载之前', () => {
    const serverContent = readFileSync(resolve(ROOT, 'packages/brain/server.js'), 'utf8');
    const brainIdx = serverContent.indexOf("use('/api/brain', brainRoutes)");
    const pipelineIdx = serverContent.indexOf("use('/api/brain', contentPipelineRoutes)");
    expect(brainIdx).toBeGreaterThan(-1);
    expect(pipelineIdx).toBeGreaterThan(-1);
    expect(brainIdx).toBeLessThan(pipelineIdx);
  });
});

describe('team-dashboard.api.ts：fetchContentPerformance 使用 analytics/content', () => {
  it('引用 /analytics/content 端点', () => {
    const apiContent = readFileSync(
      resolve(ROOT, 'apps/api/features/business/api/team-dashboard.api.ts'),
      'utf8'
    );
    expect(apiContent).toContain('analytics/content');
  });

  it('ContentPerformance 包含 analytics 字段', () => {
    const apiContent = readFileSync(
      resolve(ROOT, 'apps/api/features/business/api/team-dashboard.api.ts'),
      'utf8'
    );
    expect(apiContent).toContain('ContentAnalyticsItem[]');
    expect(apiContent).toContain('analytics:');
  });
});

describe('TeamDashboardV1.tsx：支持 analytics 数据展示', () => {
  it('ContentRankingPanel 优先使用 analytics 数据', () => {
    const uiContent = readFileSync(
      resolve(ROOT, 'apps/api/features/business/pages/TeamDashboardV1.tsx'),
      'utf8'
    );
    expect(uiContent).toContain('hasAnalytics');
    expect(uiContent).toContain('data!.analytics');
  });
});
