import { describe, it, expect } from 'vitest';

describe('harness-gan.graph — GanContractState session_map', () => {
  it('GanContractState 含 session_map 字段，默认值 {}', async () => {
    const { GanContractState } = await import('../../workflows/harness-gan.graph.js');
    expect('session_map' in GanContractState.spec).toBe(true);
  });

  it('session_map reducer 是 shallow merge（不丢旧轮）', async () => {
    const { GanContractState } = await import('../../workflows/harness-gan.graph.js');
    const ann = GanContractState.spec.session_map;
    const reduceFn = ann.operator ?? ann.reducer;
    const after1 = reduceFn({}, { 1: { container: 'c1', session_uuid: 'u1' } });
    const after2 = reduceFn(after1, { 2: { container: 'c2', session_uuid: 'u2' } });
    expect(after2[1]).toEqual({ container: 'c1', session_uuid: 'u1' });
    expect(after2[2]).toEqual({ container: 'c2', session_uuid: 'u2' });
  });
});
