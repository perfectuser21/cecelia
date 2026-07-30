/**
 * War Room PR-C 路由退役回归测试
 *
 * 断言历史死页 / 重复详情页已退役：
 * - 退役路由 redirect 到 /pipeline，不再 404
 * - 退役页对应的 component 映射已移除
 * - 保留路由（/pipeline、/pipeline/:id、/pipeline/:id/step/:step、/live-monitor）仍存在
 */

import { describe, it, expect } from 'vitest';
import systemHub from './index';
import execution from '../execution/index';
import type { FeatureRoute } from '../types';

function routeFor(routes: FeatureRoute[], path: string): FeatureRoute | undefined {
  return routes.find(r => r.path === path);
}

describe('system-hub 路由退役（War Room PR-C）', () => {
  const routes = systemHub.routes;

  it('保留 /pipeline 战情室入口（component WarRoomPage）', () => {
    const r = routeFor(routes, '/pipeline');
    expect(r?.component).toBe('WarRoomPage');
  });

  it('保留 /pipeline/:id 详情（component HarnessPipelineDetailPage）', () => {
    expect(routeFor(routes, '/pipeline/:id')?.component).toBe('HarnessPipelineDetailPage');
  });

  it('保留 /pipeline/:id/step/:step 步骤钻取', () => {
    expect(routeFor(routes, '/pipeline/:id/step/:step')?.component).toBe('HarnessPipelineStepPage');
  });

  it('保留 /live-monitor（不动）', () => {
    expect(routeFor(routes, '/live-monitor')?.component).toBe('LiveMonitor');
  });

  it('保留 /warroom/gp/:gpId 断言账本入口与组件映射', () => {
    expect(routeFor(routes, '/warroom/gp/:gpId')?.component).toBe('WarRoomGoldenPathPage');
    expect(systemHub.components.WarRoomGoldenPathPage).toBeTypeOf('function');
  });

  it('退役 /autonomous → redirect /pipeline', () => {
    const r = routeFor(routes, '/autonomous');
    expect(r?.redirect).toBe('/pipeline');
    expect(r?.component).toBeUndefined();
  });

  it('退役 /harness/:id → redirect /pipeline', () => {
    const r = routeFor(routes, '/harness/:id');
    expect(r?.redirect).toBe('/pipeline');
    expect(r?.component).toBeUndefined();
  });

  it('移除 /initiatives/:id 的死 harness 组件映射（不再指向 InitiativeDetail）', () => {
    // system-hub 不再注册 /initiatives/:id 组件路由（planning 仍持有该路径的工作页）
    const r = routeFor(routes, '/initiatives/:id');
    expect(r?.component).toBeUndefined();
  });

  it('components 映射不再包含已删除的死页', () => {
    const keys = Object.keys(systemHub.components);
    expect(keys).not.toContain('AutonomousSessionsPage');
    expect(keys).not.toContain('HarnessPipelinePage');
    expect(keys).not.toContain('InitiativeDetail');
    expect(keys).not.toContain('HarnessStreamPage');
    expect(keys).not.toContain('HarnessDetailPage');
  });

  it('navItem 不再含 Autonomous 入口', () => {
    const sys = routeFor(routes, '/system');
    const children = sys?.navItem?.children ?? [];
    expect(children.some(c => c.path === '/autonomous')).toBe(false);
  });
});

describe('execution 路由退役（War Room PR-C）', () => {
  const routes = execution.routes;

  it('退役 /harness-pipeline → 直接渲染 WarRoomPage（DynamicRouter 不支持 redirect，用 component 代替）', () => {
    const r = routeFor(routes, '/harness-pipeline');
    expect(r?.component).toBe('WarRoomPage');
    expect(r?.navItem).toBeUndefined();
  });

  it('退役 /harness-pipeline/:id → 直接渲染 HarnessPipelineDetailPage', () => {
    expect(routeFor(routes, '/harness-pipeline/:id')?.component).toBe('HarnessPipelineDetailPage');
  });

  it('退役 /harness-pipeline/:id/step/:step → 直接渲染 HarnessPipelineStepPage', () => {
    expect(routeFor(routes, '/harness-pipeline/:id/step/:step')?.component).toBe('HarnessPipelineStepPage');
  });

  it('execution components 不再含 HarnessPipelinePage', () => {
    expect(Object.keys(execution.components)).not.toContain('HarnessPipelinePage');
  });
});
