import { describe, it, expect } from 'vitest';
import { computeGateVerdict, computeAiStatus } from '../acceptance-state.js';

/** 造 n 个全绿格，其中 hardKeys 里的标 hard */
function cells(n, { hardKeys = [], overrides = {} } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const check_key = `S${i + 1}-c1`;
    return {
      check_key,
      hard: hardKeys.includes(check_key),
      final_state: overrides[check_key] || '绿',
    };
  });
}

describe('computeGateVerdict — 绿当且仅当全格绿', () => {
  it('36 格全绿 → 绿，red_cells 为空', () => {
    const r = computeGateVerdict(cells(36), {});
    expect(r.gate_verdict).toBe('绿');
    expect(r.red_cells).toEqual([]);
    expect(r.blocked_reason).toBeNull();
  });

  it('任一格「未定」→ 红（不是绿）', () => {
    const r = computeGateVerdict(cells(36, { overrides: { 'S9-c1': '未定' } }), {});
    expect(r.gate_verdict).toBe('红');
  });

  it('hard 格非绿 → 红且 red_cells 含该格号', () => {
    const r = computeGateVerdict(
      cells(36, { hardKeys: ['S13-c1'], overrides: { 'S13-c1': '红' } }), {}
    );
    expect(r.gate_verdict).toBe('红');
    expect(r.red_cells).toContain('S13-c1');
  });

  it('hard 格为 Q3′（未定）时不得判绿', () => {
    const r = computeGateVerdict(
      cells(36, { hardKeys: ['S8-c1'], overrides: { 'S8-c1': '未定' } }), {}
    );
    expect(r.gate_verdict).toBe('红');
    expect(r.red_cells).toContain('S8-c1');
  });

  it('run 标 ai_incomplete 时闸一律拦，且与「格红」机械可区分', () => {
    const r = computeGateVerdict(cells(36), { ai_incomplete: true });
    expect(r.gate_verdict).toBe('红');
    expect(r.blocked_reason).toBe('ai_run_infra_error');
    expect(r.red_cells).toEqual([]);
  });
});

describe('computeAiStatus — 哑火三条件（分母与阈值从 yaml 派生，不硬编码）', () => {
  /** machineDbTotal=19 时阈值 = ceil(19/2) = 10；=18 时 = 9（Gate B 回落后的位移） */
  const ok = Array.from({ length: 36 }, (_, i) => ({
    check_key: `S${i + 1}-c1`, ai_verdict: '通过', ai_reason: null, verifiable_by: 'machine_db',
  }));

  it('全部有确定判定 → 不哑火', () => {
    const r = computeAiStatus(ok, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('ok');
    expect(r.ai_incomplete).toBe(false);
  });

  it('条件① 确定判定格数 == 0 → 哑火', () => {
    const cs = ok.map((c) => ({ ...c, ai_verdict: '无法验证', ai_reason: 'timeout' }));
    expect(computeAiStatus(cs, { machineDbTotal: 19 }).ai_status).toBe('dumb');
  });

  it('条件① 单独成立时 reasons 只含 no_decided_cells（与②③ 隔离）', () => {
    // 上一例的全 timeout 构造会同时点着条件②（36 个 machine_db 故障 ≥ 10），
    // 于是「条件① 判据被删掉」这种变异照样能让它绿。换成全 human_only 合法无法验证：
    // 确定判定 0（①成立）、human_only 不计故障（②不成立）、无缺格（③不成立），条件① 才被单独钉住。
    const cs = ok.map((c) => ({
      ...c, verifiable_by: 'human_only', ai_verdict: '无法验证', ai_reason: 'human_only',
    }));
    const r = computeAiStatus(cs, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('dumb');
    expect(r.reasons).toEqual(['no_decided_cells']);
  });

  it('条件② machine_db 格故障类无法验证达到阈值（19 → 10）→ 哑火', () => {
    const cs = ok.map((c, i) => (i < 10
      ? { ...c, ai_verdict: '无法验证', ai_reason: 'page_unreachable' } : c));
    const r = computeAiStatus(cs, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('dumb');
    expect(r.reasons).toContain('machine_db_failures');
  });

  it('条件② 差一格不到阈值 → 不哑火', () => {
    const cs = ok.map((c, i) => (i < 9
      ? { ...c, ai_verdict: '无法验证', ai_reason: 'page_unreachable' } : c));
    expect(computeAiStatus(cs, { machineDbTotal: 19 }).ai_status).toBe('ok');
  });

  it('分母位移到 18 时阈值随之降到 9（不硬编码 10）', () => {
    const cs = ok.map((c, i) => (i < 9
      ? { ...c, ai_verdict: '无法验证', ai_reason: 'timeout' } : c));
    expect(computeAiStatus(cs, { machineDbTotal: 18 }).ai_status).toBe('dumb');
  });

  it('条件③ 缺格数 > 0 → 哑火', () => {
    const cs = ok.map((c, i) => (i === 5 ? { ...c, ai_verdict: null } : c));
    const r = computeAiStatus(cs, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('dumb');
    expect(r.reasons).toContain('missing_cells');
    expect(r.missing_cells).toEqual(['S6-c1']);
  });

  it('合法 human_only 无法验证不计入条件②（那不是故障）', () => {
    const cs = ok.map((c, i) => (i < 12
      ? { ...c, verifiable_by: 'human_only', ai_verdict: '无法验证', ai_reason: 'human_only' } : c));
    expect(computeAiStatus(cs, { machineDbTotal: 19 }).ai_status).toBe('ok');
  });
});

describe('undecided_cells 与 blocked_reason 三态：闸判红时必须说得出卡在哪几格', () => {
  it('非 hard 未定格 → 红 + undecided_cells 含该格 + blocked_reason=undecided_cells', () => {
    const r = computeGateVerdict(cells(36, { overrides: { 'S9-c1': '未定' } }), {});
    expect(r.gate_verdict).toBe('红');
    expect(r.red_cells).toEqual([]);
    expect(r.undecided_cells).toEqual(['S9-c1']);
    expect(r.blocked_reason).toBe('undecided_cells');
  });

  it('hard 未定格同时进 red_cells 与 undecided_cells，理由回落格红（null）', () => {
    const r = computeGateVerdict(
      cells(36, { hardKeys: ['S8-c1'], overrides: { 'S8-c1': '未定' } }), {}
    );
    expect(r.red_cells).toContain('S8-c1');
    expect(r.undecided_cells).toContain('S8-c1');
    expect(r.blocked_reason).toBeNull();
  });

  it('真红格在场时 blocked_reason 保持 null，与 undecided_cells 态可区分', () => {
    const r = computeGateVerdict(
      cells(36, { overrides: { 'S5-c1': '红', 'S9-c1': '未定' } }), {}
    );
    expect(r.red_cells).toEqual(['S5-c1']);
    expect(r.undecided_cells).toEqual(['S9-c1']);
    expect(r.blocked_reason).toBeNull();
  });

  it('全绿 → undecided_cells 为空', () => {
    expect(computeGateVerdict(cells(36), {}).undecided_cells).toEqual([]);
  });

  it('ai_incomplete 短路态不谈格级明细，两个清单都空且理由是 infra', () => {
    const r = computeGateVerdict(cells(36, { overrides: { 'S9-c1': '未定' } }), { ai_incomplete: true });
    expect(r.red_cells).toEqual([]);
    expect(r.undecided_cells).toEqual([]);
    expect(r.blocked_reason).toBe('ai_run_infra_error');
  });
});

describe('输入非法时 fail-fast，不得静默降级成放行', () => {
  it('cells 为空（run 没建行/取数挂了）→ 抛错，不得判绿', () => {
    expect(() => computeGateVerdict([], {})).toThrow(/建行格/);
  });

  it('final_state 出现 CELL_STATES 枚举外的脏值 → 抛错，不得当成非绿悄悄拦', () => {
    // 脏值既不等于'绿'（于是算进 notGreen 判红），又不是'红'也不是'未定'（于是两个清单都收不到它），
    // 正是「红但卡在空」换一种形式复现。域外值只可能来自上游写坏，抛错让它在闸这层就显形。
    const cs = cells(36, { overrides: { 'S3-c1': 'PASS' } });
    expect(() => computeGateVerdict(cs, {})).toThrow(/S3-c1/);
  });

  it('machineDbTotal 缺失 → 抛错，不得让条件② 悄悄失效', () => {
    const cs = Array.from({ length: 36 }, (_, i) => ({
      check_key: `S${i + 1}-c1`, ai_verdict: '无法验证', ai_reason: 'timeout', verifiable_by: 'machine_db',
    }));
    expect(() => computeAiStatus(cs, {})).toThrow(/machineDbTotal/);
  });
});

describe('缺格 → 哑火 → 闸拦：裁决通道不得成为缺格的静默放行口', () => {
  // computeCellState 把裁决排在 Q0′ 短路之前，所以一个 ai_verdict IS NULL 的缺格
  // 只要被人裁决绿，格级 final_state 就是「绿」。若闸只汇总 final_state，
  // 「AI 只回写少数几格、其余靠裁决补绿」就能整轮放行——正是 v7-final:275 点名的静默放行口。
  // 因此 ai_incomplete 必须是与「格红」并列的独立拦截路径，而不是 final_state 的下游。
  it('全部 36 格 final_state 绿，但本轮有缺格 → 闸仍拦，且理由是 infra 不是格红', () => {
    const aiCells = Array.from({ length: 36 }, (_, i) => ({
      check_key: `S${i + 1}-c1`,
      ai_verdict: i < 8 ? '通过' : null, // AI 只回写 8 个 hard 格，其余 28 格未跑
      ai_reason: null,
      verifiable_by: 'machine_db',
    }));
    const ai = computeAiStatus(aiCells, { machineDbTotal: 19 });
    expect(ai.ai_incomplete).toBe(true);
    expect(ai.missing_cells).toHaveLength(28);

    // 那 28 个缺格全被裁决判绿 → 格级视角一片绿
    const r = computeGateVerdict(cells(36), ai);
    expect(r.gate_verdict).toBe('红');
    expect(r.blocked_reason).toBe('ai_run_infra_error');
    expect(r.red_cells).toEqual([]);
  });
});
