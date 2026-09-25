/**
 * 守卫 1：goal_id 必须是 KR 级（决策 105a5868，链 bf5088a3 棒5，任务 3fad28e0）。
 * tick 派发白名单是 key_results(active|in_progress|decomposing) 的 id；
 * 任务挂 Objective id 会被 selectNextDispatchableTask 静默过滤、永远 queued 且无日志。
 */
import { describe, it, expect, vi } from 'vitest';
import { assertGoalIsKeyResult, GoalGuardError, DISPATCHABLE_KR_STATUSES } from '../goal-guard.js';

const KR = '11111111-1111-4111-8111-111111111111';
const OBJ = '22222222-2222-4222-8222-222222222222';

function makeDb({ kr = null, objective = null, siblings = [] } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/FROM key_results WHERE id/.test(sql)) return { rows: kr ? [kr] : [] };
      if (/FROM objectives WHERE id/.test(sql)) return { rows: objective ? [objective] : [] };
      if (/FROM key_results WHERE objective_id/.test(sql)) return { rows: siblings };
      return { rows: [] };
    }),
  };
}

describe('assertGoalIsKeyResult', () => {
  it('goal_id 未给（null/undefined）→ 直通且不查库（行为不变）', async () => {
    const db = makeDb();
    await expect(assertGoalIsKeyResult(db, null)).resolves.toEqual({ warning: null });
    await expect(assertGoalIsKeyResult(db, undefined)).resolves.toEqual({ warning: null });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('goal_id 是 active KR → 通过、无 warning', async () => {
    const db = makeDb({ kr: { id: KR, status: 'active' } });
    await expect(assertGoalIsKeyResult(db, KR)).resolves.toEqual({ warning: null });
  });

  it('违规输入被拒：给了 Objective id → 抛 goal_id_not_key_result，details 标 is_objective 并列出 KR', async () => {
    const db = makeDb({
      objective: { id: OBJ, title: '工厂基建' },
      siblings: [{ id: KR, title: 'KR-1', status: 'active' }],
    });
    const err = await assertGoalIsKeyResult(db, OBJ).catch((e) => e);
    expect(err).toBeInstanceOf(GoalGuardError);
    expect(err.code).toBe('goal_id_not_key_result');
    expect(err.details.is_objective).toBe(true);
    expect(err.details.key_results).toEqual([{ id: KR, title: 'KR-1', status: 'active' }]);
    expect(err.message).toMatch(/KR/);
  });

  it('违规输入被拒：完全不存在的 uuid → 抛，is_objective=false', async () => {
    const err = await assertGoalIsKeyResult(makeDb(), OBJ).catch((e) => e);
    expect(err).toBeInstanceOf(GoalGuardError);
    expect(err.details.is_objective).toBe(false);
  });

  it('违规输入被拒：非 uuid 字符串 → 抛（不让脏值进 SQL 转型报 500）', async () => {
    const db = makeDb();
    const err = await assertGoalIsKeyResult(db, 'not-a-uuid').catch((e) => e);
    expect(err).toBeInstanceOf(GoalGuardError);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('KR 存在但状态不在派发白名单 → 不拒，返回 warning（仍是合法 KR）', async () => {
    const db = makeDb({ kr: { id: KR, status: 'completed' } });
    const r = await assertGoalIsKeyResult(db, KR);
    expect(r.warning).toMatch(/completed/);
    expect(DISPATCHABLE_KR_STATUSES).toEqual(['active', 'in_progress', 'decomposing']);
  });
});
