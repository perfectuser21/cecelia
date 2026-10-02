import { beforeAll, describe, expect, it } from 'vitest';
import { buildCoreConfig, coreFeatures } from './index';
import type { CoreConfig } from './types';

describe('Cecelia 主导航', () => {
  let config: CoreConfig;

  beforeAll(async () => {
    config = await buildCoreConfig();
  });

  it('只展示三个可折叠分类及其职责内的入口', () => {
    expect(config.navGroups).toHaveLength(1);
    expect(config.navGroups[0].title).toBe('');
    expect(config.navGroups[0].items.map(item => ({
      label: item.label,
      path: item.path,
      children: item.children?.map(child => child.path),
    }))).toEqual([
      {
        label: '运行与诊断', path: '/system',
        children: [
          '/system', '/system/cecelia', '/system/automation', '/system/engine',
          '/map', '/system/feature-map', '/test-pyramid', '/traces', '/ledger',
          '/workbench/activity', '/knowledge/dev-log', '/cecelia/growth', '/cecelia/evolution',
        ],
      },
      {
        label: 'AI 管理', path: '/brain-models',
        children: ['/brain-models', '/account-usage', '/system/team', '/knowledge/memory', '/settings'],
      },
      {
        label: '机器资源', path: '/machines',
        children: ['/machines', '/system/infra', '/live-monitor', '/system/claude'],
      },
    ]);
  });

  it('22 个终端入口去重且全部有可加载的页面', () => {
    const leaves = config.navGroups.flatMap(group => group.items.flatMap(item => item.children ?? [item]));
    expect(leaves).toHaveLength(22);
    expect(leaves.find(item => item.path === '/account-usage')?.label).toBe('AI 额度');
    expect(new Set(leaves.map(item => item.path)).size).toBe(22);
    for (const item of leaves) {
      const route = config.allRoutes.find(route => route.path === item.path);
      expect(route?.component, item.path).toBeTruthy();
      expect(config.pageComponents[route!.component!], item.path).toBeTypeOf('function');
    }
  });

  it('运行健康入口只匹配自身，避免跨机器与 AI 管理分类高亮', () => {
    const health = config.navGroups.flatMap(group => group.items.flatMap(item => item.children ?? []))
      .find(item => item.path === '/system');
    expect(health).toMatchObject({ exact: true });
  });

  it('主导航收口后保留全部 manifest 路由和页面加载器', async () => {
    const manifests = await Promise.all(Object.values(coreFeatures).map(loader => loader().then(module => module.default)));
    for (const manifest of manifests) {
      for (const route of manifest.routes) {
        expect(config.allRoutes).toContainEqual(expect.objectContaining({
          path: route.path,
          ...(route.redirect ? { redirect: route.redirect } : { component: route.component }),
        }));
      }
    }
    expect(config.pageComponents).toEqual(Object.assign({}, ...manifests.map(manifest => manifest.components)));
  });

  it('任务规划、内容生产、知识记录与 Notion 维护入口不再出现在主导航', () => {
    const visiblePaths = config.navGroups.flatMap(group => group.items.flatMap(item => [item.path, ...(item.children?.map(child => child.path) ?? [])]));
    for (const path of [
      '/workbench/inbox', '/cecelia/chat', '/workbench/overview', '/workbench/tasks', '/workbench/projections',
      '/gtd', '/gtd/area', '/gtd/okr', '/gtd/projects', '/gtd/tasks', '/gtd/knowledge',
      '/today', '/pipeline', '/strategist', '/okr-roadmap',
      '/content-factory', '/knowledge/content', '/knowledge/decisions',
      '/knowledge/designs', '/knowledge/diary', '/cecelia/diary', '/clips',
    ]) {
      expect(visiblePaths, path).not.toContain(path);
      expect(config.allRoutes.some(route => route.path === path), path).toBe(true);
    }
    expect(visiblePaths).toContain('/knowledge/memory');
  });

  it.each(['/', '/workbench'])('%s 默认进入运行与诊断', path => {
    expect(config.allRoutes.find(route => route.path === path)?.redirect).toBe('/system');
  });
});
