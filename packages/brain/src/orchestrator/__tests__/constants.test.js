/**
 * constants.js 配对测试（lint-test-pairing）：
 * 枚举完整性 + 数值 pin（防改值后语义漂移，数值出处见 routing-extraction.md）。
 */
import { describe, it, expect } from 'vitest';
import {
  ACTION, ACTIONS, LOG_ACTION,
  MAX_FIX_ROUNDS, MAX_POLL_COUNT, POLL_INTERVAL_MS, MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK, MAX_REBASE_ATTEMPTS, MAX_HOPS, BLOCKED_SAME_STATE_CAP, BUDGET_CAP_USD,
} from '../constants.js';

describe('constants', () => {
  it('9 个上限常量数值 pin（出处=旧图，routing-extraction.md）', () => {
    expect(MAX_FIX_ROUNDS).toBe(20);
    expect(MAX_POLL_COUNT).toBe(20);
    expect(POLL_INTERVAL_MS).toBe(90000);
    expect(MAX_NO_PUSH_STREAK).toBe(2);
    expect(MAX_NO_VERDICT_STREAK).toBe(3);
    expect(MAX_REBASE_ATTEMPTS).toBe(3);
    expect(MAX_HOPS).toBe(200);
    expect(BLOCKED_SAME_STATE_CAP).toBe(2);
    expect(BUDGET_CAP_USD).toBe(10);
  });

  it('ACTION 枚举含全部派发与控制 action，ACTIONS 派生一致', () => {
    for (const a of ['spawn:planner', 'spawn:proposer', 'spawn:reviewer', 'spawn:generator',
      'spawn:generator-fix', 'spawn:evaluator', 'spawn:judge', 'persist_contract_approval',
      'mark_failed', 'exit']) {
      expect(ACTIONS, `缺 action ${a}`).toContain(a);
    }
    expect(ACTIONS).toEqual(Object.values(ACTION));
  });

  it('LOG_ACTION 含 T3 写入契约的 4 个 verdict 行 action', () => {
    expect(Object.values(LOG_ACTION)).toEqual(
      expect.arrayContaining(['verdict:evaluate', 'verdict:judge', 'verdict:reviewer', 'verdict:human_review'])
    );
  });
});

// ─── 确定性守卫（原 determinism.test.js，lint-test-pairing 要求测试文件 import 同名实现，
//     该守卫无实现文件故并入本文件；守卫对象是纯函数层源码文本，spec §测试策略 §5）───
import { readFileSync } from 'node:fs';

const PURE_FILES = ['derive.js', 'gates.js', 'constants.js', 'counters.js'];
const FORBIDDEN = ['Date.now(', 'Math.random(', 'new Date('];

describe('确定性守卫：纯函数层禁非确定性调用', () => {
  for (const file of PURE_FILES) {
    for (const token of FORBIDDEN) {
      it(`${file} 不含 ${token}`, () => {
        const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        expect(src.includes(token)).toBe(false);
      });
    }
  }
});
