/**
 * home-sequencer 包内单测（配套 tests/gp/f1/step3-home-sequencer-core.test.js）。
 * GP 那份锁「边」的行为契约；这份锁模块 API 形状与边界值。
 */
import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER,
  GEAR_STAGE_TABLE,
  VERDICTS,
  stagesForGear,
  routeVerdict,
  buildCheckpointDigest,
  parseCommanderReply,
} from '../home-sequencer.js';

describe('home-sequencer 模块 API', () => {
  it('格序与档位表冻结，裁定词表 = 画布四词', () => {
    expect(Object.isFrozen(STAGE_ORDER)).toBe(true);
    expect(Object.isFrozen(GEAR_STAGE_TABLE)).toBe(true);
    expect(VERDICTS).toEqual(['accepted', 'retry', 'blocked', 'stopped']);
  });

  it('每档格序都是完整格序的子序列（不许乱序/发明新格）', () => {
    for (const stages of Object.values(GEAR_STAGE_TABLE)) {
      const idx = stages.map((s) => STAGE_ORDER.indexOf(s));
      expect(idx).not.toContain(-1);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it('stopped → 终局 stopped（画布 abort 语义）', () => {
    expect(routeVerdict('plan', 'stopped', { gear: 'new_capability', attempt: 1 }))
      .toEqual({ kind: 'finalize', status: 'stopped' });
  });

  it('末格 __run_finalize accepted → 终局 completed', () => {
    expect(routeVerdict('__run_finalize', 'accepted', { gear: 'parameter_only', attempt: 1 }))
      .toEqual({ kind: 'finalize', status: 'completed' });
  });

  it('bugfix 档里 seal blocked 同样改道 contract（判则跨档一致）', () => {
    expect(routeVerdict('seal', 'blocked', { gear: 'bugfix', attempt: 1 }).target)
      .toBe('contract');
  });

  it('digest：空 evidence/空 summary 不抛异常', () => {
    const d = buildCheckpointDigest({ stage_id: 'plan', stage_attempt: 1, status: 'completed' });
    expect(d).toMatch(/plan/);
  });

  it('parseCommanderReply：null/空串安全', () => {
    expect(parseCommanderReply(null).verdict).toBeNull();
    expect(parseCommanderReply('').verdict).toBeNull();
  });
});

describe('双层收口·机械层（组合 79 批 schema 校验）', () => {
  it('generate 缺 candidate_coordinates → 机械层拒收，点名交接件', async () => {
    const { mechanicalCheckpoint } = await import('../home-sequencer.js');
    const r = mechanicalCheckpoint('generate', [{ type: 'note', text: 'x' }]);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/candidate_coordinates/);
  });

  it('无交接要求的格（cleanup）→ 放行，零误伤', async () => {
    const { mechanicalCheckpoint } = await import('../home-sequencer.js');
    expect(mechanicalCheckpoint('cleanup', []).ok).toBe(true);
  });
});
