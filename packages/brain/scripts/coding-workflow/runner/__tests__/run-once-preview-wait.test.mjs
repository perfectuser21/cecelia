import { describe, it, expect } from 'vitest';
import { useQaEnv } from './helpers/qa-env.mjs';

describe('预览等待必须有界', () => {
  const E = useQaEnv();
  for (const kind of ['pending', 'error']) {
    it(`${kind} 跨 tick 计时，超时升级且不运行 QA`, async () => {
      if (kind === 'pending') E.preview.status[77].status = 'starting';
      const extra = kind === 'error' ? { CODING_WF_PREVIEW_API: 'http://127.0.0.1:1' } : {};
      let r = await E.go(E.green(), { extra });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(E.state().preview).toMatchObject({ waiting_since: expect.any(String), waiting_head: E.head });
      expect(E.brainStateResults().at(-1).qa_state.preview).toEqual(E.state().preview);
      expect(E.state().escalated).toBeUndefined();
      expect(E.qaCalls()).toEqual([]);
      const since = E.state().preview.waiting_since;
      await E.closeBrain();
      r = await E.go(E.green(), { extra: { ...extra, CODING_WF_QA_PREVIEW_ESCALATE_MS: '0' } });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(E.state().escalated).toMatchObject({ type: 'qa_preview_unavailable', preview_state: kind, since });
      expect(E.brainResults().at(-1).escalations).toEqual([expect.objectContaining({ type: 'qa_preview_unavailable', pr: 77 })]);
      expect(E.qaCalls()).toEqual([]);
    });
  }
  it('预览恢复 active 后清除旧等待计时并正常 QA', async () => {
    E.seedState({ preview: { waiting_since: '2020-01-01T00:00:00.000Z', waiting_head: E.head } });
    const r = await E.go(E.green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state().passed).toBe(true);
    expect(E.state().preview.waiting_since).toBeUndefined();
  });
  it('PR head 改变后重新计时，不沿用旧构建的等待超时', async () => {
    E.preview.status[77].status = 'starting';
    E.seedState({ preview: { waiting_since: '2020-01-01T00:00:00.000Z', waiting_head: 'a'.repeat(40) } });
    const r = await E.go(E.green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state().preview.waiting_head).toBe(E.head);
    expect(E.state().preview.waiting_since).not.toBe('2020-01-01T00:00:00.000Z');
    expect(E.state().escalated).toBeUndefined();
  });
});
