// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Commander 收口 ↔ 机械契约校验器
//
// 守卫落在真实的边上：check-handoffs.mjs 是 Commander 各格收口时的机械判定器
// （CHECKS→CONTRACTS 九格+八格）。本步骤断言真 import 被改的流水线模块
// check-handoffs.mjs（不 vi.mock），验证「未知格绝不静默 PASS / 无 resolver
// fail-closed 判 UNDECIDABLE / coding 派生自真实格序」这三条边不可退化。
import { describe, expect, it } from 'vitest';
import {
  CODING_CELLS,
  LEADGEN_CELLS,
  CONTRACTS,
  runCellContracts,
} from '../../../packages/brain/src/orchestrator/check-handoffs.mjs';
import { STAGE_ORDER } from '../../../packages/brain/src/orchestrator/home-sequencer.js';

const VALID_CANDIDATE = {
  repo: 'perfectuser21/cecelia',
  branch: 'cp-x',
  head_sha: 'a'.repeat(40),
  bridge_run_id: '11111111-1111-4111-8111-111111111111',
  source_attempt_id: '22222222-2222-4222-8222-222222222222',
};

describe('F1 step3 — check-handoffs 契约校验器守卫在真实的边上', () => {
  it('coding 九格派生自真实 home-sequencer.STAGE_ORDER（不 hardcode）', () => {
    expect(CODING_CELLS).toEqual(STAGE_ORDER.filter((s) => !s.startsWith('__')));
    expect(CODING_CELLS).toHaveLength(9);
    expect(LEADGEN_CELLS).toHaveLength(8);
    expect(Object.keys(CONTRACTS)).toHaveLength(17);
  });

  it('未知格标识显式抛 unknown_cell，绝不静默放行', async () => {
    await expect(runCellContracts('bogus_cell', {}, {})).rejects.toThrow(/unknown_cell/);
  });

  it('无 db resolver 的 generate 格 fail-closed（存在 UNDECIDABLE → ok=false）', async () => {
    const res = await runCellContracts('generate', { candidate: { ...VALID_CANDIDATE } }, {});
    expect(res.cell).toBe('generate');
    expect(res.ok).toBe(false);
    expect(res.results.some((r) => r.status === 'UNDECIDABLE')).toBe(true);
  });
});
