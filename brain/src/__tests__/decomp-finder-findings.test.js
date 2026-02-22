/**
 * decomp-finder-findings.test.js
 *
 * D4: decomp-checker findings 为空时的降级行为
 * 测试 checkExploratoryDecompositionContinue() 在 findings 为空时输出 WARN 日志
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock pool - must be set up before importing decomposition-checker.js
// ─────────────────────────────────────────────────────────────────────────────

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// ─────────────────────────────────────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────────────────────────────────────

const { checkExploratoryDecompositionContinue } = await import('../decomposition-checker.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a mock exploratory task row (simulates DB query result).
 */
function makeExpTask({ id = 'exp-1', title = 'Explore Feature X', findings = null, result = null } = {}) {
  const payload = {};
  if (findings !== null) payload.findings = findings;
  if (result !== null) payload.result = result;
  return {
    id,
    title,
    project_id: 'proj-1',
    goal_id: 'goal-1',
    payload,
  };
}

/**
 * Set up mockPool to return the given tasks from the first SELECT query,
 * and a successful INSERT from createDecompositionTask's internal pool.query.
 */
function setupMockPool(tasks) {
  // First call: SELECT completed exploratory tasks
  // Subsequent calls: INSERT in createDecompositionTask
  mockPool.query
    .mockResolvedValueOnce({ rows: tasks })
    .mockResolvedValue({ rows: [{ id: 'new-task-id', title: 'new task' }], rowCount: 1 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('checkExploratoryDecompositionContinue - findings降级 (D4)', () => {
  let warnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('D4-1: 当 payload.findings 为空时输出 WARN 日志', async () => {
    const task = makeExpTask({ id: 'exp-empty', title: 'Explore Empty Findings', findings: null, result: null });
    setupMockPool([task]);

    await checkExploratoryDecompositionContinue();

    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).toContain('exp-empty');
    expect(warnText).toContain('empty findings');
  });

  it('D4-2: 当 payload.findings 有内容时不输出 WARN', async () => {
    const task = makeExpTask({ id: 'exp-ok', title: 'Explore With Findings', findings: 'Found something useful' });
    setupMockPool([task]);

    await checkExploratoryDecompositionContinue();

    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).not.toContain('empty findings');
  });

  it('D4-3: 当 payload.result 有内容（但无 findings）时不输出 WARN', async () => {
    const task = makeExpTask({ id: 'exp-result', title: 'Explore With Result', findings: null, result: 'Result content' });
    setupMockPool([task]);

    await checkExploratoryDecompositionContinue();

    const warnText = warnSpy.mock.calls.flat().join(' ');
    // payload.result fallback 有值，不应告警
    expect(warnText).not.toContain('empty findings');
  });

  it('D4-4: 没有待处理的 exploratory 任务时不告警', async () => {
    setupMockPool([]); // 空结果

    await checkExploratoryDecompositionContinue();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('D4-5: 多个任务中只有空 findings 的输出 WARN', async () => {
    const taskWithFindings = makeExpTask({ id: 'exp-good', findings: 'Good findings' });
    const taskNoFindings = makeExpTask({ id: 'exp-bad', findings: null, result: null });

    // Two SELECT calls for two tasks (decomp-checker may create two separate tasks)
    mockPool.query
      .mockResolvedValueOnce({ rows: [taskWithFindings, taskNoFindings] })
      .mockResolvedValue({ rows: [{ id: 'new-task-id', title: 'new task' }], rowCount: 1 });

    await checkExploratoryDecompositionContinue();

    const warnText = warnSpy.mock.calls.flat().join(' ');
    // Only exp-bad should trigger warn
    expect(warnText).toContain('exp-bad');
    expect(warnText).not.toContain('exp-good');
  });

  it('D4-6: findings 为空字符串时也输出 WARN', async () => {
    const task = makeExpTask({ id: 'exp-empty-str', findings: '' });
    setupMockPool([task]);

    await checkExploratoryDecompositionContinue();

    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).toContain('exp-empty-str');
    expect(warnText).toContain('empty findings');
  });
});
