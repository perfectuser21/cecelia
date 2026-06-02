/**
 * warroom-classify.test.js — 战情室分类纯函数测试
 */
import { describe, it, expect } from 'vitest';
import {
  slug, classifyArea, classifyGroup, classifyKind, detailRoute, normStatus,
} from '../warroom-classify.js';

describe('slug', () => {
  it('kebab-cases ascii', () => {
    expect(slug('Brain API')).toBe('brain-api');
  });
  it('保留中文', () => {
    expect(slug('客户私域 AI 接管')).toBe('客户私域-ai-接管');
  });
  it('空值兜底 unknown', () => {
    expect(slug('')).toBe('unknown');
    expect(slug(null)).toBe('unknown');
  });
});

describe('classifyArea', () => {
  it('base_repo 含 zenithjoy → ZenithJoy', () => {
    const t = { payload: { base_repo: 'https://github.com/perfectuser21/zenithjoy-workspace.git' } };
    expect(classifyArea(t)).toMatchObject({ areaKey: 'zenithjoy', areaName: 'ZenithJoy' });
  });
  it('base_repo 含 infrastructure → Infrastructure', () => {
    const t = { payload: { base_repo: '/Users/administrator/perfect21/infrastructure' } };
    expect(classifyArea(t)).toMatchObject({ areaKey: 'infra' });
  });
  it('base_repo 含 cecelia → Cecelia', () => {
    const t = { payload: { base_repo: 'https://github.com/perfectuser21/cecelia.git' } };
    expect(classifyArea(t)).toMatchObject({ areaKey: 'cecelia' });
  });
  it('无 base_repo（本地 dev 任务）→ Cecelia 兜底', () => {
    expect(classifyArea({ payload: {} })).toMatchObject({ areaKey: 'cecelia' });
    expect(classifyArea({})).toMatchObject({ areaKey: 'cecelia' });
  });
});

describe('classifyGroup', () => {
  const cecelia = { areaKey: 'cecelia' };
  const zj = { areaKey: 'zenithjoy' };

  it('有 journey 名 → 直接作为 group', () => {
    const g = classifyGroup({}, zj, '客户私域 AI 接管');
    expect(g).toMatchObject({ groupName: '客户私域 AI 接管' });
    expect(g.groupKey).toBe('客户私域-ai-接管');
  });

  it('Cecelia 无 journey + 标题含 dashboard → Dashboard', () => {
    const g = classifyGroup({ title: 'Harness Pipeline 进度条 dashboard' }, cecelia, null);
    expect(g.groupKey).toBe('dashboard');
  });

  it('Cecelia 无 journey + sprint_dir 含 engine → Engine', () => {
    const g = classifyGroup({ payload: { sprint_dir: 'sprints/engine-hook-fix' } }, cecelia, null);
    expect(g.groupKey).toBe('engine');
  });

  it('Cecelia 无 journey + 含 deploy → Infra', () => {
    const g = classifyGroup({ title: 'deploy.yml 修复' }, cecelia, null);
    expect(g.groupKey).toBe('infra');
  });

  it('Cecelia 无 journey + 普通 brain 任务 → Brain API 兜底', () => {
    const g = classifyGroup({ title: 'GET /api/brain/harness/runs 接口' }, cecelia, null);
    expect(g.groupKey).toBe('brain');
  });

  it('ZenithJoy 无 journey → 未分类', () => {
    const g = classifyGroup({ title: '某 ZJ 任务' }, zj, null);
    expect(g.groupKey).toBe('uncategorized');
  });
});

describe('classifyKind', () => {
  it('harness_initiative → sprint', () => { expect(classifyKind('harness_initiative')).toBe('sprint'); });
  it('content-pipeline → pipeline', () => { expect(classifyKind('content-pipeline')).toBe('pipeline'); });
  it('platform_scraper → scraper', () => { expect(classifyKind('platform_scraper')).toBe('scraper'); });
  it('dev → task', () => { expect(classifyKind('dev')).toBe('task'); });
  it('未知 → task', () => { expect(classifyKind('whatever')).toBe('task'); });
});

describe('detailRoute', () => {
  it('sprint → /pipeline/:id', () => {
    expect(detailRoute({ id: 'abc' }, 'sprint')).toBe('/pipeline/abc');
  });
  it('task → /tasks/:id/prd', () => {
    expect(detailRoute({ id: 'xyz' }, 'task')).toBe('/tasks/xyz/prd');
  });
});

describe('normStatus', () => {
  it('in_progress/queued/claimed → active', () => {
    expect(normStatus('in_progress')).toBe('active');
    expect(normStatus('queued')).toBe('active');
    expect(normStatus('claimed')).toBe('active');
  });
  it('completed → done', () => { expect(normStatus('completed')).toBe('done'); });
  it('failed/blocked → failed', () => {
    expect(normStatus('failed')).toBe('failed');
    expect(normStatus('blocked')).toBe('failed');
  });
  it('canceled/cancelled → canceled', () => {
    expect(normStatus('canceled')).toBe('canceled');
    expect(normStatus('cancelled')).toBe('canceled');
  });
});
