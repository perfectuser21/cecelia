/**
 * warroom-classify.test.js — 战情室分类纯函数测试
 */
import { describe, it, expect } from 'vitest';
import {
  slug, classifyArea, classifyGroup, classifyKind, detailRoute, normStatus,
  shanghaiDay, toFeedItem, buildFeed, computeStats,
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
  it('dev → task', () => { expect(classifyKind('dev')).toBe('task'); });
  it('未知 → task', () => { expect(classifyKind('whatever')).toBe('task'); });
});

describe('detailRoute', () => {
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

describe('shanghaiDay', () => {
  it('UTC 时间转上海日期（+8 跨天）', () => {
    expect(shanghaiDay('2026-06-01T17:00:00Z')).toBe('2026-06-02');
  });
  it('空值 → 空串', () => {
    expect(shanghaiDay(null)).toBe('');
    expect(shanghaiDay('')).toBe('');
  });
});

describe('toFeedItem', () => {
  it('携带 Work Router / Map / Impact Contract 审计投影', () => {
    const routing = {
      work_kind: 'coding_mutation', pipeline: 'headed', repo: 'cecelia',
      map_status: 'fresh', impact_contract_status: 'active',
      route_reason: 'coding mutation headed ledger', blocking_gate: null,
    };
    const item = toFeedItem({
      id: 'audit-1', task_type: 'dev', status: 'queued',
      title: 'audit', created_at: '2026-08-13T00:00:00Z', routing,
    }, null, null, Date.now());
    expect(item.routing).toEqual(routing);
  });

  const now = new Date('2026-06-02T04:00:00Z').getTime();

  it('active task：elapsed 用 now-started，带进度', () => {
    const t = {
      id: 't1', task_type: 'dev', status: 'in_progress',
      title: 'GET /api/brain/x 接口', priority: 'P1',
      started_at: '2026-06-02T03:00:00Z', completed_at: null,
      payload: { base_repo: 'https://github.com/x/cecelia.git' },
    };
    const item = toFeedItem(t, null, { pct: 40, node: 'ganLoop' }, now);
    expect(item).toMatchObject({
      id: 't1', kind: 'task', status: 'active', progress_pct: 40,
      current_node: 'ganLoop', detail_route: '/tasks/t1/prd',
    });
    expect(item.elapsed_ms).toBe(3600_000);
  });

  it('failed task：带 fail_reason，无进度', () => {
    const t = {
      id: 't2', task_type: 'dev', status: 'failed',
      title: 'fix bug', error_message: 'exit 28 timeout',
      started_at: '2026-06-02T03:00:00Z', completed_at: '2026-06-02T03:30:00Z',
      payload: {},
    };
    const item = toFeedItem(t, null, null, now);
    expect(item).toMatchObject({
      kind: 'task', status: 'failed', fail_reason: 'exit 28 timeout',
      detail_route: '/tasks/t2/prd', progress_pct: null,
    });
    expect(item.elapsed_ms).toBe(1800_000);
  });

  it('pr_url 从 result 兜底', () => {
    const t = { id: 't3', task_type: 'dev', status: 'completed', title: 'x', payload: {}, result: { pr_url: 'http://pr/9' } };
    expect(toFeedItem(t, null, null, now).pr_url).toBe('http://pr/9');
  });


});

describe('buildFeed', () => {
  const now = Date.now();
  const tasks = [
    { id: 'a', task_type: 'dev', status: 'in_progress', title: 'brain x', created_at: '2026-06-02T01:00:00Z', payload: { base_repo: 'cecelia.git' } },
    { id: 'b', task_type: 'dev', status: 'failed', title: 'brain y', created_at: '2026-06-02T00:00:00Z', payload: { base_repo: 'cecelia.git' } },
    { id: 'c', task_type: 'dev', status: 'completed', title: 'iLink 通道', created_at: '2026-06-01T00:00:00Z', payload: { base_repo: 'zenithjoy-workspace.git', journey_id: 'j1' } },
  ];

  it('按 area 分组 + 数量正确 + cecelia 排前', () => {
    const areas = buildFeed(tasks, { j1: '客户私域 AI 接管' }, {}, now);
    expect(areas.find(a => a.areaKey === 'cecelia').count).toBe(2);
    expect(areas.find(a => a.areaKey === 'zenithjoy').count).toBe(1);
    expect(areas[0].areaKey).toBe('cecelia');
  });

  it('ZenithJoy 任务用 journey 名做 group', () => {
    const areas = buildFeed(tasks, { j1: '客户私域 AI 接管' }, {}, now);
    expect(areas.find(a => a.areaKey === 'zenithjoy').groups[0].groupName).toBe('客户私域 AI 接管');
  });

  it('group 内 active 排在 failed 前', () => {
    const areas = buildFeed(tasks, {}, {}, now);
    const brain = areas.find(a => a.areaKey === 'cecelia').groups.find(g => g.groupKey === 'brain');
    expect(brain.tasks[0].status).toBe('active');
    expect(brain.tasks[1].status).toBe('failed');
  });


});

describe('computeStats', () => {
  const tasks = [
    { id: '1', status: 'in_progress', created_at: '2026-06-02T01:00:00Z' },
    { id: '2', status: 'completed', completed_at: '2026-06-02T02:00:00Z', pr_url: 'http://pr/1' },
    { id: '3', status: 'failed', completed_at: '2026-06-02T03:00:00Z' },
    { id: '4', status: 'completed', completed_at: '2026-05-20T00:00:00Z', pr_url: 'http://pr/2' },
  ];
  it('今日 done/failed + active + 本月 PR', () => {
    const s = computeStats(tasks, '2026-06-02');
    expect(s.active).toBe(1);
    expect(s.done_today).toBe(1);
    expect(s.failed_today).toBe(1);
    expect(s.pr_this_month).toBe(1); // 仅 task2 在 6 月（task4 PR 是 5 月）
  });
});

// ───────────────────────── Line 中心化（PR-A）─────────────────────────
import {
  classifyJourneyArea, computeStepProgress, journeyIdKeys, taskMatchesJourney,
} from '../warroom-classify.js';

describe('classifyJourneyArea', () => {
  // ── biz_area 一等字段优先（Alex 08-05 拍板：分区不许靠名字正则猜）──
  it('[BEHAVIOR] biz_area 字段优先于名字正则：智能客服 GP-B + zenithjoy → zenithjoy', () => {
    expect(classifyJourneyArea('智能客服 · GP-B 被动接待', 'zenithjoy')).toBe('zenithjoy');
  });
  it('[BEHAVIOR] biz_area=infrastructure 直出（正则无此桶）', () => {
    expect(classifyJourneyArea('西安机群CI/RPA基础设施', 'infrastructure')).toBe('infrastructure');
  });
  it('[BEHAVIOR] biz_area 非法值忽略，退回正则兜底', () => {
    expect(classifyJourneyArea('智能发布', 'not-a-bucket')).toBe('zenithjoy');
  });
  it('[BEHAVIOR] 无 biz_area 时保持正则兜底行为（存量兼容）', () => {
    expect(classifyJourneyArea('工厂 · F5 指挥舱')).toBe('cecelia');
  });

  it('智能发布 → zenithjoy', () => {
    expect(classifyJourneyArea('智能发布')).toBe('zenithjoy');
  });
  it('视频剪辑 → zenithjoy', () => {
    expect(classifyJourneyArea('视频剪辑')).toBe('zenithjoy');
  });
  it('ZenithJoy 运营中枢 → zenithjoy', () => {
    expect(classifyJourneyArea('ZenithJoy 运营中枢')).toBe('zenithjoy');
  });
  it('客户智能获客路径 → zenithjoy', () => {
    expect(classifyJourneyArea('客户智能获客路径')).toBe('zenithjoy');
  });
  it('客户私域 AI 接管 → zenithjoy', () => {
    expect(classifyJourneyArea('客户私域 AI 接管')).toBe('zenithjoy');
  });
  it('客户首次成功路径 → zenithjoy（含"客户"）', () => {
    expect(classifyJourneyArea('客户首次成功路径')).toBe('zenithjoy');
  });
  it('Line 02 客户智能获客 → zenithjoy（含 Line 0）', () => {
    expect(classifyJourneyArea('Line 02 客户智能获客路径')).toBe('zenithjoy');
  });
  it('MJ1 · 主理人开发闭环 → cecelia', () => {
    expect(classifyJourneyArea('MJ1 · 主理人开发闭环')).toBe('cecelia');
  });
  it('Cecelia Harness Pipeline → cecelia', () => {
    expect(classifyJourneyArea('Cecelia Harness Pipeline')).toBe('cecelia');
  });
  it('Agent 系统 hardening → cecelia', () => {
    expect(classifyJourneyArea('Agent 系统 hardening')).toBe('cecelia');
  });
  it('空/无名 → cecelia 兜底', () => {
    expect(classifyJourneyArea('')).toBe('cecelia');
    expect(classifyJourneyArea(null)).toBe('cecelia');
    expect(classifyJourneyArea(undefined)).toBe('cecelia');
  });
});

describe('computeStepProgress', () => {
  it('done 状态计入 step_done', () => {
    const steps = [
      { status: 'done' }, { status: 'planned' }, { status: 'in_progress' }, { status: 'done' },
    ];
    expect(computeStepProgress(steps)).toEqual({ step_total: 4, step_done: 2 });
  });
  it('空数组 → 0/0', () => {
    expect(computeStepProgress([])).toEqual({ step_total: 0, step_done: 0 });
    expect(computeStepProgress(null)).toEqual({ step_total: 0, step_done: 0 });
  });
  it('completed 也算 done', () => {
    expect(computeStepProgress([{ status: 'completed' }, { status: 'done' }]))
      .toEqual({ step_total: 2, step_done: 2 });
  });
});

describe('journeyIdKeys / taskMatchesJourney', () => {
  const journey = { id: 'uuid-1', notion_id: 'notion-1' };
  it('journeyIdKeys 同时含 id 和 notion_id', () => {
    expect(journeyIdKeys(journey).sort()).toEqual(['notion-1', 'uuid-1']);
  });
  it('journeyIdKeys 缺 notion_id 只含 id', () => {
    expect(journeyIdKeys({ id: 'uuid-1', notion_id: null })).toEqual(['uuid-1']);
  });
  it('task.payload.journey_id === journey.id 匹配', () => {
    expect(taskMatchesJourney({ payload: { journey_id: 'uuid-1' } }, journey)).toBe(true);
  });
  it('task.payload.journey_id === journey.notion_id 匹配', () => {
    expect(taskMatchesJourney({ payload: { journey_id: 'notion-1' } }, journey)).toBe(true);
  });
  it('无关 journey_id 不匹配', () => {
    expect(taskMatchesJourney({ payload: { journey_id: 'other' } }, journey)).toBe(false);
  });
  it('task 无 journey_id 不匹配', () => {
    expect(taskMatchesJourney({ payload: {} }, journey)).toBe(false);
    expect(taskMatchesJourney({}, journey)).toBe(false);
  });
});
