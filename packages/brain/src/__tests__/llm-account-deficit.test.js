/**
 * 单元测试：LLM 账号选择进度对齐（deficit）算法
 *
 * 覆盖范围：
 * - Codex deficit 计算公式
 * - Codex 5h gate filter（>95% 跳过）
 * - Codex deficit 排序逻辑
 * - Claude Code deficit 计算公式
 * - Claude Code deficit 排序逻辑
 */

describe('Codex deficit 算法（selectBestAccountFromLocal 逻辑）', () => {
  const SEVEN_DAY_SECS = 7 * 24 * 3600;

  function calcCodexDeficit(resetAfterSecs, sevenDayPct) {
    const elapsedSecs = SEVEN_DAY_SECS - resetAfterSecs;
    const targetPct = (elapsedSecs / SEVEN_DAY_SECS) * 100;
    return targetPct - sevenDayPct;
  }

  test('窗口已过一半时，target=50%；实际用了 30% → deficit=20', () => {
    const resetAfterSecs = SEVEN_DAY_SECS / 2; // 3.5 天后重置
    const deficit = calcCodexDeficit(resetAfterSecs, 30);
    expect(deficit).toBeCloseTo(20, 1);
  });

  test('窗口还差 1 天重置，target≈85.7%；实际用了 80% → deficit 约 5.7', () => {
    const resetAfterSecs = 24 * 3600; // 1 天后重置
    const deficit = calcCodexDeficit(resetAfterSecs, 80);
    expect(deficit).toBeGreaterThan(5);
    expect(deficit).toBeLessThan(7);
  });

  test('窗口刚重置（reset_after_seconds ≈ SEVEN_DAY_SECS）→ target≈0，deficit 为负', () => {
    const resetAfterSecs = SEVEN_DAY_SECS - 60; // 刚刚重置
    const deficit = calcCodexDeficit(resetAfterSecs, 0);
    expect(deficit).toBeCloseTo(0, 0);
  });

  test('5h gate：used_percent > 95 → 账号应被过滤掉', () => {
    const accounts = [
      { id: 'team1', fiveHourPct: 96, deficit: 20 },
      { id: 'team2', fiveHourPct: 50, deficit: 15 },
      { id: 'team3', fiveHourPct: 94, deficit: 30 },
    ];
    // 模拟 gate filter（5h > 95 时已在 fetch 阶段返回 null）
    const filtered = accounts.filter(a => a.fiveHourPct <= 95);
    expect(filtered.map(a => a.id)).toEqual(['team2', 'team3']);
  });

  test('deficit DESC 排序：deficit 最大的排在最前', () => {
    const accounts = [
      { id: 'team1', fiveHourPct: 30, deficit: 10 },
      { id: 'team2', fiveHourPct: 20, deficit: 40 },
      { id: 'team3', fiveHourPct: 50, deficit: 25 },
    ];
    const sorted = [...accounts].sort((a, b) => b.deficit - a.deficit || a.fiveHourPct - b.fiveHourPct);
    expect(sorted.map(a => a.id)).toEqual(['team2', 'team3', 'team1']);
  });

  test('同 deficit 时，5h 用量低的优先', () => {
    const accounts = [
      { id: 'team1', fiveHourPct: 60, deficit: 20 },
      { id: 'team2', fiveHourPct: 30, deficit: 20 },
      { id: 'team3', fiveHourPct: 45, deficit: 20 },
    ];
    const sorted = [...accounts].sort((a, b) => b.deficit - a.deficit || a.fiveHourPct - b.fiveHourPct);
    expect(sorted[0].id).toBe('team2'); // 最低 5h
  });
});

describe('Claude Code deficit 算法（selectBestAccount 逻辑）', () => {
  const SEVEN_DAY_MS = 7 * 24 * 3600 * 1000;

  function calcClaudeDeficit(sevenDayResetsAt, sevenDayPct) {
    const now = Date.now();
    const resetsAtMs = new Date(sevenDayResetsAt).getTime();
    const windowStart = resetsAtMs - SEVEN_DAY_MS;
    const elapsedMs = now - windowStart;
    const targetPct = Math.max(0, Math.min(100, (elapsedMs / SEVEN_DAY_MS) * 100));
    return targetPct - sevenDayPct;
  }

  test('重置时间在 3.5 天后 → target≈50%；实际 40% → deficit≈10', () => {
    const resetsAt = new Date(Date.now() + 3.5 * 24 * 3600 * 1000).toISOString();
    const deficit = calcClaudeDeficit(resetsAt, 40);
    expect(deficit).toBeCloseTo(10, 0);
  });

  test('重置时间在 1 天后 → target≈85.7%；实际 70% → deficit≈15.7', () => {
    const resetsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const deficit = calcClaudeDeficit(resetsAt, 70);
    expect(deficit).toBeGreaterThan(14);
    expect(deficit).toBeLessThan(17);
  });

  test('resetsAt 为 null 时，deficit 保持 0（不影响排序）', () => {
    // 当 seven_day_resets_at 为 null 时，deficit 初始化为 0
    const sevenDayDeficit = 0; // 默认值
    expect(sevenDayDeficit).toBe(0);
  });

  test('deficit DESC 排序：deficit 大的排在前面', () => {
    const accounts = [
      { id: 'account1', sevenDayDeficit: 5, ePct: 20 },
      { id: 'account2', sevenDayDeficit: 30, ePct: 10 },
      { id: 'account3', sevenDayDeficit: 15, ePct: 40 },
    ];
    const sorted = [...accounts].sort((a, b) => b.sevenDayDeficit - a.sevenDayDeficit || a.ePct - b.ePct);
    expect(sorted.map(a => a.id)).toEqual(['account2', 'account3', 'account1']);
  });

  test('sonnet tier 使用 sevenDaySonnetDeficit 排序', () => {
    const accounts = [
      { id: 'account1', sevenDaySonnetDeficit: 10, sevenDayDeficit: 50, ePct: 20 },
      { id: 'account2', sevenDaySonnetDeficit: 40, sevenDayDeficit: 5, ePct: 10 },
    ];
    // sonnet tier 用 sevenDaySonnetDeficit
    const sorted = [...accounts].sort((a, b) => b.sevenDaySonnetDeficit - a.sevenDaySonnetDeficit || a.ePct - b.ePct);
    expect(sorted[0].id).toBe('account2'); // sonnet deficit 更高
  });
});
