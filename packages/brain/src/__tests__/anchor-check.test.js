/**
 * S2 锚点执法闸单元测试（MJ5 刀2）
 *
 * DoD 行为验证：
 * [BEHAVIOR] B1 — 无锚新 dev 任务被拒（missing_anchor）
 * [BEHAVIOR] B2 — 带锚 dev 任务放行
 * [BEHAVIOR] B3 — arch_review 任务免锚放行
 * [BEHAVIOR] B4 — ci_patrol 任务免锚放行
 * [BEHAVIOR] B5 — payload.action=spike 免锚放行
 * [BEHAVIOR] B6 — payload.action=hotfix_emergency 免锚放行
 * [BEHAVIOR] B7 — 存量任务（刀2上线前创建）免锚放行
 * [BEHAVIOR] B8 — harness_initiative 免锚放行
 * [BEHAVIOR] B9 — 锚点缺 step_id 时仍被拒
 */

import { describe, it, expect } from 'vitest';
import { checkAnchor, ANCHOR_LEGACY_CUTOFF } from '../anchor-check.js';

// 存量豁免为【日历日】边界（naive timestamp 跨时区解析防偏移，见 anchor-check.js 注释）：
// 上线日当天及之后 = 强制；前一日及更早 = 豁免。
const AFTER_CUTOFF = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60000).toISOString();
const BEFORE_CUTOFF = new Date(ANCHOR_LEGACY_CUTOFF.getTime() - 24 * 3600 * 1000).toISOString();

const VALID_ANCHOR = { journey_id: 'j1', gp_id: 'gp1', step_id: 's1' };

describe('S2 anchor-check — checkAnchor', () => {
  it('[B1] 无锚新 dev 任务被拒', () => {
    const task = {
      task_type: 'dev',
      created_at: AFTER_CUTOFF,
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('missing_anchor');
  });

  it('[B2] 带锚 dev 任务放行', () => {
    const task = {
      task_type: 'dev',
      created_at: AFTER_CUTOFF,
      payload: { anchor: VALID_ANCHOR },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B3] arch_review 任务免锚放行', () => {
    const task = {
      task_type: 'arch_review',
      created_at: AFTER_CUTOFF,
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B4] ci_patrol 任务免锚放行', () => {
    const task = {
      task_type: 'ci_patrol',
      created_at: AFTER_CUTOFF,
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B5] payload.action=spike 免锚放行', () => {
    const task = {
      task_type: 'dev',
      created_at: AFTER_CUTOFF,
      payload: { action: 'spike' },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B6] payload.action=hotfix_emergency 免锚放行', () => {
    const task = {
      task_type: 'dev',
      created_at: AFTER_CUTOFF,
      payload: { action: 'hotfix_emergency' },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B7] 存量任务（刀2上线前创建）免锚放行', () => {
    const task = {
      task_type: 'dev',
      created_at: BEFORE_CUTOFF,
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B8] harness_initiative 免锚放行', () => {
    const task = {
      task_type: 'harness_initiative',
      created_at: AFTER_CUTOFF,
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B9] 锚点缺 step_id 时仍被拒', () => {
    const task = {
      task_type: 'dev',
      created_at: AFTER_CUTOFF,
      payload: { anchor: { journey_id: 'j1', gp_id: 'gp1' } },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('missing_anchor');
  });

  it('[B10] displacement action 免锚放行', () => {
    const task = {
      task_type: 'dev',
      created_at: AFTER_CUTOFF,
      payload: { action: 'displacement' },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B11] task 无 created_at 视为新任务，无锚被拒', () => {
    const task = {
      task_type: 'dev',
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(true);
  });

  it('[B12] research 任务免锚放行', () => {
    const task = {
      task_type: 'research',
      created_at: AFTER_CUTOFF,
      payload: {},
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('[B13] strategist_decision 任务免锚放行', () => {
    const task = {
      task_type: 'strategist_decision',
      created_at: AFTER_CUTOFF,
      payload: { trigger: 'run_terminal', journey_id: 'j1' },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });
});
