/**
 * WarRoomPage 纯函数单测
 * 覆盖战情室页面的展示纯函数：耗时格式化、相对时间、状态元信息、
 * Area 过滤、默认选中任务、kind 标签。
 *
 * 与页面渲染解耦——这些是 WarRoomPage.tsx 导出的无副作用工具函数。
 */

import { describe, it, expect } from 'vitest';
import {
  formatElapsed,
  relativeTime,
  statusMeta,
  kindLabel,
  formatPriority,
  verdictMeta,
  filterArea,
  filterByKind,
  isToday,
  applyViewFilters,
  pickDefaultTask,
  absoluteShanghai,
  shanghaiClock,
  stageRows,
  elapsedForStatus,
  type FeedArea,
  type FeedTask,
  type FeedStage,
} from '../WarRoomPage';

describe('formatElapsed（耗时格式化）', () => {
  it('null / 0 / 负数返回空串', () => {
    expect(formatElapsed(null)).toBe('');
    expect(formatElapsed(0)).toBe('');
    expect(formatElapsed(-5)).toBe('');
  });

  it('秒级', () => {
    expect(formatElapsed(5_000)).toBe('5s');
  });

  it('分钟级（有余秒拼接）', () => {
    expect(formatElapsed(90_000)).toBe('1m30s');
    expect(formatElapsed(120_000)).toBe('2m');
  });

  it('小时级（有余分拼接）', () => {
    expect(formatElapsed(3_600_000)).toBe('1h');
    expect(formatElapsed(3_900_000)).toBe('1h5m');
  });

  it('天级', () => {
    expect(formatElapsed(86_400_000)).toBe('1d');
    expect(formatElapsed(90_000_000)).toBe('1d1h');
  });
});

describe('relativeTime（相对时间）', () => {
  it('刚刚', () => {
    expect(relativeTime(new Date().toISOString())).toBe('刚刚');
  });

  it('几分钟前', () => {
    const t = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(relativeTime(t)).toMatch(/^\d+分钟前$/);
  });

  it('几小时前', () => {
    const t = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(relativeTime(t)).toMatch(/^\d+小时前$/);
  });

  it('几天前', () => {
    const t = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(relativeTime(t)).toMatch(/^\d+天前$/);
  });

  it('空值返回空串', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime('')).toBe('');
  });
});

describe('statusMeta（状态元信息）', () => {
  it('四态都有 label / dot / pill', () => {
    for (const s of ['active', 'done', 'failed', 'canceled'] as const) {
      const m = statusMeta(s);
      expect(m.label).toBeTruthy();
      expect(m.dot).toBeTruthy();
      expect(m.pill).toBeTruthy();
    }
  });

  it('active → 进行中', () => {
    expect(statusMeta('active').label).toBe('进行中');
  });

  it('failed → 失败', () => {
    expect(statusMeta('failed').label).toBe('失败');
  });

  it('未知状态有兜底', () => {
    // @ts-expect-error 故意传非法值验证兜底
    expect(statusMeta('weird').label).toBeTruthy();
  });
});

describe('kindLabel（种类标签）', () => {
  it('各 kind 映射', () => {
    expect(kindLabel('sprint')).toBe('Sprint');
    expect(kindLabel('pipeline')).toBe('Pipeline');
    expect(kindLabel('scraper')).toBe('采集');
    expect(kindLabel('task')).toBe('Task');
  });
});

// ---- 测试夹具 ----
function mkTask(over: Partial<FeedTask>): FeedTask {
  return {
    id: 't1',
    kind: 'sprint',
    title: 'demo',
    status: 'done',
    raw_status: 'completed',
    priority: null,
    created_at: new Date().toISOString(),
    elapsed_ms: null,
    progress_pct: null,
    current_node: null,
    fail_reason: null,
    pr_url: null,
    detail_route: '/pipeline/t1',
    ...over,
  };
}

const SAMPLE: FeedArea[] = [
  {
    areaKey: 'cecelia',
    areaName: 'Cecelia',
    order: 0,
    count: 2,
    groups: [
      {
        groupKey: 'brain',
        groupName: 'Brain API',
        count: 2,
        tasks: [
          mkTask({ id: 'c-done', status: 'done' }),
          mkTask({ id: 'c-active', status: 'active' }),
        ],
      },
    ],
  },
  {
    areaKey: 'zenithjoy',
    areaName: 'ZenithJoy',
    order: 1,
    count: 1,
    groups: [
      {
        groupKey: 'line05',
        groupName: 'Line 05',
        count: 1,
        tasks: [mkTask({ id: 'z-fail', status: 'failed' })],
      },
    ],
  },
];

describe('filterArea（Area 过滤）', () => {
  it("'all' 返回全部 area", () => {
    expect(filterArea(SAMPLE, 'all')).toHaveLength(2);
  });

  it('按 areaKey 过滤', () => {
    const out = filterArea(SAMPLE, 'zenithjoy');
    expect(out).toHaveLength(1);
    expect(out[0].areaKey).toBe('zenithjoy');
  });

  it('不存在的 key 返回空', () => {
    expect(filterArea(SAMPLE, 'nope')).toHaveLength(0);
  });
});

describe('pickDefaultTask（默认选中）', () => {
  it('优先返回首个 active 任务', () => {
    const t = pickDefaultTask(SAMPLE);
    expect(t?.id).toBe('c-active');
  });

  it('无 active 时返回首个任务', () => {
    const noActive: FeedArea[] = [{ ...SAMPLE[1] }];
    expect(pickDefaultTask(noActive)?.id).toBe('z-fail');
  });

  it('空数据返回 null', () => {
    expect(pickDefaultTask([])).toBeNull();
  });
});

describe('formatPriority（优先级显示，去重 P）', () => {
  it('已含 P 前缀不重复加 P', () => {
    expect(formatPriority('P1')).toBe('P1');
    expect(formatPriority('P0')).toBe('P0');
    expect(formatPriority('p2')).toBe('P2'); // 归一大写
  });

  it('裸数字补 P 前缀', () => {
    expect(formatPriority(2)).toBe('P2');
    expect(formatPriority('3')).toBe('P3');
  });

  it('空值返回空串', () => {
    expect(formatPriority(null)).toBe('');
    expect(formatPriority('')).toBe('');
  });
});

describe('filterByKind（任务种类过滤）', () => {
  const MIXED: FeedArea[] = [
    {
      areaKey: 'cecelia',
      areaName: 'Cecelia',
      order: 0,
      count: 2,
      groups: [
        {
          groupKey: 'brain',
          groupName: 'Brain API',
          count: 2,
          tasks: [
            mkTask({ id: 's1', kind: 'sprint' }),
            mkTask({ id: 't1k', kind: 'task' }),
          ],
        },
      ],
    },
    {
      areaKey: 'zenithjoy',
      areaName: 'ZenithJoy',
      order: 1,
      count: 1,
      groups: [
        { groupKey: 'l5', groupName: 'Line 05', count: 1, tasks: [mkTask({ id: 'p1', kind: 'pipeline' })] },
      ],
    },
  ];

  it("'all' 原样返回", () => {
    expect(filterByKind(MIXED, 'all')).toHaveLength(2);
  });

  it('只留匹配 kind 的任务，空组/空 area 被剔除', () => {
    const out = filterByKind(MIXED, 'task');
    expect(out).toHaveLength(1);
    expect(out[0].areaKey).toBe('cecelia');
    expect(out[0].groups[0].tasks.map((t) => t.id)).toEqual(['t1k']);
  });

  it('pipeline 只命中 ZenithJoy', () => {
    const out = filterByKind(MIXED, 'pipeline');
    expect(out).toHaveLength(1);
    expect(out[0].areaKey).toBe('zenithjoy');
  });

  it('过滤后 count 反映剩余任务数', () => {
    const out = filterByKind(MIXED, 'sprint');
    expect(out[0].count).toBe(1);
    expect(out[0].groups[0].count).toBe(1);
  });

  it('无命中返回空数组', () => {
    expect(filterByKind(MIXED, 'scraper')).toHaveLength(0);
  });
});

describe('verdictMeta（最终验收结论样式）', () => {
  it('PASS → 绿色 + label PASS', () => {
    const m = verdictMeta('PASS');
    expect(m).not.toBeNull();
    expect(m!.label).toBe('PASS');
    expect(m!.pill).toMatch(/emerald|green/);
  });

  it('FAIL → 红色 + label FAIL', () => {
    const m = verdictMeta('FAIL');
    expect(m).not.toBeNull();
    expect(m!.label).toBe('FAIL');
    expect(m!.pill).toMatch(/red/);
  });

  it('大小写归一', () => {
    expect(verdictMeta('pass')!.label).toBe('PASS');
  });

  it('空/未知 → null（不渲染徽章）', () => {
    expect(verdictMeta(null)).toBeNull();
    expect(verdictMeta('')).toBeNull();
  });
});

describe('absoluteShanghai（绝对上海时间，用于 title 悬停）', () => {
  it('固定 UTC 时刻 → 上海时间（UTC+8）', () => {
    // 2026-06-03T00:00:00Z = 上海 2026-06-03 08:00:00
    const s = absoluteShanghai('2026-06-03T00:00:00Z');
    expect(s).toContain('2026');
    expect(s).toContain('08:00');
  });

  it('不随浏览器时区漂移：跨日 UTC 仍按 +8 渲染', () => {
    // 2026-06-02T20:00:00Z = 上海 2026-06-03 04:00:00
    const s = absoluteShanghai('2026-06-02T20:00:00Z');
    expect(s).toContain('2026-06-03');
    expect(s).toContain('04:00');
  });

  it('空/非法值返回空串', () => {
    expect(absoluteShanghai(null)).toBe('');
    expect(absoluteShanghai('')).toBe('');
    expect(absoluteShanghai('not-a-date')).toBe('');
  });
});

describe('shanghaiClock（顶栏时钟，强制上海时区）', () => {
  it('返回 HH:MM:SS 24 小时格式', () => {
    const c = shanghaiClock(new Date('2026-06-03T00:00:00Z'));
    expect(c).toBe('08:00:00');
  });

  it('凌晨补零 + 24 小时制（非 12 小时 AM/PM）', () => {
    const c = shanghaiClock(new Date('2026-06-03T15:05:09Z')); // 上海 23:05:09
    expect(c).toBe('23:05:09');
    expect(c).not.toMatch(/AM|PM|上午|下午/);
  });

  it('无参数时不抛错并返回 HH:MM:SS 串', () => {
    expect(shanghaiClock()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('elapsedForStatus（历时仅对 in_progress 显示）', () => {
  it('in_progress → 正常格式化', () => {
    expect(elapsedForStatus(90_000, 'in_progress')).toBe('1m30s');
  });

  it('queued → 空串（不显示误导累加值）', () => {
    expect(elapsedForStatus(90_000, 'queued')).toBe('');
  });

  it('completed / failed / 其它原始状态 → 空串', () => {
    expect(elapsedForStatus(90_000, 'completed')).toBe('');
    expect(elapsedForStatus(90_000, 'failed')).toBe('');
    expect(elapsedForStatus(90_000, 'blocked')).toBe('');
  });

  it('in_progress 但 ms 非正 → 空串', () => {
    expect(elapsedForStatus(0, 'in_progress')).toBe('');
    expect(elapsedForStatus(null, 'in_progress')).toBe('');
  });
});

describe('stageRows（stage 时间线渲染行）', () => {
  const STAGES: FeedStage[] = [
    { key: 'plan', label: 'Planner', status: 'done', elapsed_ms: 5_000 },
    { key: 'gen', label: 'Generator', status: 'running', elapsed_ms: null },
    { key: 'eval', label: 'Evaluator', status: 'pending', elapsed_ms: null },
    { key: 'final', label: 'Final E2E', status: 'failed', elapsed_ms: 12_000 },
  ];

  it('空/缺省安全：null 与 [] 都返回空数组', () => {
    expect(stageRows(null)).toEqual([]);
    expect(stageRows(undefined)).toEqual([]);
    expect(stageRows([])).toEqual([]);
  });

  it('逐步映射 label/status，并把 elapsed_ms 格式化成 elapsed 串', () => {
    const rows = stageRows(STAGES);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ key: 'plan', label: 'Planner', status: 'done', elapsed: '5s' });
    expect(rows[3]).toMatchObject({ key: 'final', label: 'Final E2E', status: 'failed', elapsed: '12s' });
  });

  it('running/pending 无耗时 → elapsed 为空串', () => {
    const rows = stageRows(STAGES);
    expect(rows[1].elapsed).toBe('');
    expect(rows[2].elapsed).toBe('');
  });

  it('非法 status 兜底为 pending', () => {
    // @ts-expect-error 故意传非法 status 验证兜底
    const rows = stageRows([{ key: 'x', label: 'X', status: 'weird', elapsed_ms: null }]);
    expect(rows[0].status).toBe('pending');
  });
});

describe('isToday（上海日判断）', () => {
  const now = new Date('2026-06-03T02:00:00Z').getTime(); // 上海 2026-06-03 10:00
  it('同上海日 → true', () => {
    expect(isToday('2026-06-03T00:30:00Z', now)).toBe(true);   // 上海 08:30 同日
    expect(isToday('2026-06-02T17:00:00Z', now)).toBe(true);   // 上海 06-03 01:00 同日
  });
  it('昨天 → false', () => {
    expect(isToday('2026-06-02T01:00:00Z', now)).toBe(false);  // 上海 06-02 09:00
  });
  it('空值 → false', () => {
    expect(isToday(null, now)).toBe(false);
    expect(isToday('', now)).toBe(false);
  });
});

describe('applyViewFilters（聚焦/状态/归档 组合过滤）', () => {
  const now = new Date('2026-06-03T02:00:00Z').getTime();
  const mk = (o: Partial<FeedTask>): FeedTask => ({
    id: 'x', kind: 'sprint', title: 't', status: 'done', raw_status: 'completed',
    priority: null, created_at: '2026-06-03T01:00:00Z', elapsed_ms: null, progress_pct: null,
    current_node: null, fail_reason: null, pr_url: null, detail_route: '/x', ...o,
  });
  const make = (): FeedArea[] => [{
    areaKey: 'cecelia', areaName: 'Cecelia', order: 0, count: 5,
    groups: [{ groupKey: 'brain', groupName: 'Brain', count: 5, tasks: [
      mk({ id: 'active1', status: 'active', created_at: '2026-05-30T00:00:00Z' }), // active 但旧
      mk({ id: 'today-fail', status: 'failed', created_at: '2026-06-03T00:00:00Z' }), // 今日失败
      mk({ id: 'old-fail', status: 'failed', created_at: '2026-05-30T00:00:00Z' }), // 老失败
      mk({ id: 'today-done', status: 'done', created_at: '2026-06-03T00:30:00Z' }), // 今日完成
      mk({ id: 'canceled1', status: 'canceled', created_at: '2026-06-03T00:00:00Z' }),
    ] }],
  }];
  const ids = (areas: FeedArea[]) => areas.flatMap(a => a.groups.flatMap(g => g.tasks.map(t => t.id)));
  const base = { focusMode: false, statusFilter: 'all', hidden: new Set<string>(), showArchived: false, nowMs: now };

  it('全开放（focus off, status all）→ 全留', () => {
    expect(ids(applyViewFilters(make(), base))).toHaveLength(5);
  });

  it('聚焦模式 → 只留 active + 今日（剔老失败）', () => {
    const out = ids(applyViewFilters(make(), { ...base, focusMode: true }));
    expect(out).toContain('active1');      // active 即使旧也留
    expect(out).toContain('today-fail');   // 今日
    expect(out).toContain('today-done');
    expect(out).not.toContain('old-fail'); // 老的非 active → 剔
  });

  it('状态筛选 failed → 只留失败', () => {
    const out = ids(applyViewFilters(make(), { ...base, statusFilter: 'failed' }));
    expect(out.sort()).toEqual(['old-fail', 'today-fail']);
  });

  it('归档 + 不显示已归档 → 剔除归档项', () => {
    const out = ids(applyViewFilters(make(), { ...base, hidden: new Set(['old-fail', 'canceled1']) }));
    expect(out).not.toContain('old-fail');
    expect(out).not.toContain('canceled1');
    expect(out).toHaveLength(3);
  });

  it('显示已归档 → 归档项回来', () => {
    const out = ids(applyViewFilters(make(), { ...base, hidden: new Set(['old-fail']), showArchived: true }));
    expect(out).toContain('old-fail');
  });

  it('全过滤后空组/空 area 被剔除 + count 重算', () => {
    const out = applyViewFilters(make(), { ...base, statusFilter: 'active' });
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(1);
    expect(out[0].groups[0].count).toBe(1);
  });

  it('过滤到空 → 返回空数组', () => {
    const out = applyViewFilters(make(), { ...base, statusFilter: 'active', hidden: new Set(['active1']) });
    expect(out).toHaveLength(0);
  });
});
