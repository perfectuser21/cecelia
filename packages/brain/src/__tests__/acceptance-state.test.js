// acceptance-state.js 的配对单测（lint-test-pairing 配对文件）。
// 完整行为覆盖在三个专项文件：acceptance-cell-state.test.js（九组合矩阵 21 例）、
// acceptance-gate-verdict.test.js（gate/哑火 22 例）、acceptance-run-status.test.js（run 状态机 9 例）。
// 本文件锁定模块的导出契约与枚举域——枚举被增删值会静默改变闸语义，必须显式红。
import { describe, it, expect } from 'vitest';
import {
  RUN_STATUSES,
  CELL_STATES,
  computeRunStatus,
  computeCellState,
  computeGateVerdict,
  computeAiStatus,
} from '../acceptance-state.js';

describe('acceptance-state 导出契约', () => {
  it('RUN_STATUSES 恰为 7 值状态机（passed/failed 是历史兼容值，不在活跃枚举里）', () => {
    expect(RUN_STATUSES).toEqual([
      'pending', 'in_review', 'human_complete', 'adjudicated',
      'stale', 'expired', 'abandoned',
    ]);
  });

  it('CELL_STATES 恰为格级三终态（不适用格不建行，无第四态）', () => {
    expect(CELL_STATES).toEqual(['绿', '红', '未定']);
  });

  it('四个计算函数均为纯函数导出', () => {
    for (const fn of [computeRunStatus, computeCellState, computeGateVerdict, computeAiStatus]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('computeRunStatus：人列不通过不落 failed（A10⑤ 契约锚点）', () => {
    const status = computeRunStatus('in_review', { total: 2, pending: 0, pass: 1, fail: 1 });
    expect(status).toBe('human_complete');
  });
});
