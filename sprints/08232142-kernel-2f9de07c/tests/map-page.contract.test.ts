import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const pagePath = 'apps/api/features/planning/pages/MapPage.tsx';
const planningManifestPath = 'apps/api/features/planning/index.ts';
const systemHubManifestPath = 'apps/api/features/system-hub/index.ts';

describe('Dashboard 系统总图冻结合同', () => {
  it('系统总图页面文件存在并包含 live map 用户路径', () => {
    expect(existsSync(pagePath)).toBe(true);
    const source = readFileSync(pagePath, 'utf8');
    expect(source).toContain('/api/brain/map?scope=');
    expect(source).toContain('zenithjoy-workspace');
    expect(source).toMatch(/freshness/);
    expect(source).toMatch(/hands_off_to|交接/);
    expect(source).toMatch(/搜索|search/i);
  });

  it('planning manifest 提供唯一地图入口', () => {
    const planning = readFileSync(planningManifestPath, 'utf8');
    const systemHub = readFileSync(systemHubManifestPath, 'utf8');
    expect(planning).toContain("path: '/map'");
    expect(planning).toContain("component: 'MapPage'");
    expect(systemHub).not.toMatch(/path:\s*['"]\/map['"]/);
  });
});
