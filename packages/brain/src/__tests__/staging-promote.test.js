import { describe, it, expect, vi } from 'vitest';
import {
  resolveLine,
  decidePromote,
  runInternalPromote,
  PROMOTE_STATUS,
} from '../staging-promote.js';

// ──────────────────────────────────────────────────────────────────────────
// Slice 2：staging E2E PASS 后放行分流（决策 C 边界）
// 内部线(cecelia) 自动 promote；客户线(zenithjoy) pending_promote+通知；base_repo 缺失=保守 pending。
// ──────────────────────────────────────────────────────────────────────────

describe('resolveLine — 客户线 vs 内部线判定（base_repo）', () => {
  it('zenithjoy → customer', () => {
    expect(resolveLine('perfectuser21/zenithjoy-workspace')).toBe('customer');
    expect(resolveLine('ZenithJoy')).toBe('customer');
  });
  it('cecelia → internal', () => {
    expect(resolveLine('perfectuser21/cecelia')).toBe('internal');
  });
  it('缺失/空 base_repo → unknown（决策2：保守，不当内部线自动 promote）', () => {
    expect(resolveLine('')).toBe('unknown');
    expect(resolveLine(null)).toBe('unknown');
    expect(resolveLine(undefined)).toBe('unknown');
  });
});

describe('decidePromote — PASS 后按线分流', () => {
  it('verdict≠PASS → 不 promote（保持 Slice1 行为）', () => {
    expect(decidePromote({ verdict: 'FAIL', baseRepo: 'cecelia' }).action).toBe('none');
    expect(decidePromote({ verdict: 'SKIP', baseRepo: 'cecelia' }).action).toBe('none');
  });
  it('PASS + 内部线 → auto promote', () => {
    const d = decidePromote({ verdict: 'PASS', baseRepo: 'perfectuser21/cecelia' });
    expect(d.action).toBe('auto');
    expect(d.promoteStatus).toBe(PROMOTE_STATUS.AUTO_PROMOTED);
  });
  it('PASS + 客户线 → pending_promote（不自动）', () => {
    const d = decidePromote({ verdict: 'PASS', baseRepo: 'perfectuser21/zenithjoy-workspace' });
    expect(d.action).toBe('pending');
    expect(d.promoteStatus).toBe(PROMOTE_STATUS.PENDING_PROMOTE);
  });
  it('PASS + base_repo 缺失 → 保守 pending_promote（决策2）', () => {
    const d = decidePromote({ verdict: 'PASS', baseRepo: '' });
    expect(d.action).toBe('pending');
    expect(d.promoteStatus).toBe(PROMOTE_STATUS.PENDING_PROMOTE);
  });
});

describe('runInternalPromote — 内部线自动 promote（测试必 mock，绝不打真生产）', () => {
  it('调注入的 promoteExec（mock），成功 → promoted', async () => {
    const promoteExec = vi.fn(() => ({ ok: true, output: 'promoted dashboard' }));
    const r = await runInternalPromote({ promoteExec });
    expect(promoteExec).toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.promoteStatus).toBe(PROMOTE_STATUS.PROMOTED);
  });
  it('promote 失败 → promote_failed（不抛错）', async () => {
    const promoteExec = vi.fn(() => ({ ok: false, output: 'no staging pending' }));
    const r = await runInternalPromote({ promoteExec });
    expect(r.ok).toBe(false);
    expect(r.promoteStatus).toBe(PROMOTE_STATUS.PROMOTE_FAILED);
  });
  it('默认实现绝不在测试里跑真 promote 脚本（必须注入 promoteExec）', async () => {
    // 不传 promoteExec 时应安全拒绝（防误打真生产 :5211 live）
    const r = await runInternalPromote({});
    expect(r.ok).toBe(false);
    expect(r.promoteStatus).toBe(PROMOTE_STATUS.PROMOTE_FAILED);
  });
});
