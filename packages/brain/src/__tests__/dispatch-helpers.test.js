/**
 * dispatch-helpers.test.js
 *
 * 阶段2 Slice1：验证 selectNextDispatchableTask 把 staging_e2e 排除出外部 executor
 * 派发候选池（staging_e2e 由 staging-e2e-plugin tick 内联执行，不该被 dispatcher 抓走）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../db.js', () => ({ default: { query: queryMock } }));
vi.mock('../alertness-actions.js', () => ({ getMitigationState: () => ({ p2_paused: false }) }));

import { selectNextDispatchableTask } from '../dispatch-helpers.js';

describe('selectNextDispatchableTask — staging_e2e 排除', () => {
  beforeEach(() => queryMock.mockClear());

  it('主候选查询把 staging_e2e 排除出派发池', async () => {
    const r = await selectNextDispatchableTask(null);
    expect(r).toBeNull(); // rows 空 → 无可派发任务
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toMatch(/task_type NOT IN/);
    expect(sql).toContain("'staging_e2e'");
    // 与既有 tick/deploy watch 内联类型并列排除
    expect(sql).toContain("'harness_ci_watch'");
  });
});
