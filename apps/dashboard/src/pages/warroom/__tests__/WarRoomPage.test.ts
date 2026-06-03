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
  pickDefaultTask,
  type FeedArea,
  type FeedTask,
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
