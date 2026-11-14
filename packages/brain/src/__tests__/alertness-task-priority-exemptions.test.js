/** pauseLowPriorityTasks的现役关键路径豁免必须通过真实SQL参数绑定。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ESCALATION_EXEMPT_TASK_TYPES } from '../lib/task-type-registry.js';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { connect: mockConnect },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn(),
}));

let executeResponse;

describe('pauseLowPriorityTasks — 现役关键路径豁免', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRelease.mockImplementation(() => {});
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });

    vi.resetModules();
    vi.mock('../db.js', () => ({ default: { connect: mockConnect } }));
    vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));

    const mod = await import('../alertness/escalation.js');
    executeResponse = mod.executeResponse;
  });

  // 第一次 query 是 UPDATE tasks ...（pauseLowPriorityTasks），
  // 第二次及之后可能是 recordEscalation/updateEscalationActions
  function findUpdateCall() {
    return mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
  }

  it('UPDATE SQL 含运行时排除闸 AND NOT (task_type = ANY($4::text[]))，绑定值严格等于 ESCALATION_EXEMPT_TASK_TYPES', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });

    const updateCall = findUpdateCall();
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall;
    expect(sql).toMatch(/AND NOT \(task_type = ANY\(\$4::text\[\]\)\)/);
    expect(params[3]).toEqual(ESCALATION_EXEMPT_TASK_TYPES);
  });

  it('现役架构评审仍受保护，普通dev及退役类型没有额外特权', async () => {
    await executeResponse({
      actions: [{type:'pause_low_priority', params:{priorities:['P2','P3']}}],
    });
    const [sql,params] = findUpdateCall();
    expect(sql).toContain('trigger_source = ANY($2)');
    expect(params[1]).not.toContain('manual');
    expect(params[1]).not.toContain('owner_input');
    expect(params[0]).toEqual(['P2','P3']);
    expect(params[3]).toContain('arch_review');
    expect(params[3]).not.toContain('dev');
    expect(params[3].some(type => /^(?:harness|sprint)_/.test(type))).toBe(false);
  });
});
