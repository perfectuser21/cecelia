import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const io = vi.hoisted(() => ({ query: vi.fn(), emit: vi.fn(), capacity: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('../capacity.js', () => ({ getMaxStreams: io.capacity }));
vi.mock('../event-bus.js', () => ({ emit: io.emit }));
let nightly, tasks, reports, events, active;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:30:00Z'));
  tasks = [{ id: 'queued-task', title: '已登记工作', task_type: 'research', priority: 'P1', status: 'queued', payload: null, age_hours: 1 }];
  reports = []; events = []; active = 0;
  io.capacity.mockReset().mockReturnValue(3);
  io.emit.mockReset().mockImplementation(async (type, source, value) => { events.push({ type, source, value }); });
  io.query.mockReset().mockImplementation(async (sql, params = []) => {
    if (sql.includes('FROM tasks t')) return { rows: tasks.filter(t => t.status === 'queued' && t.payload?.dispatched_orchestrator_date !== params[0]) };
    if (sql.includes('UPDATE tasks')) {
      const task = tasks.find(t => t.id === params[1]);
      task.payload = { ...task.payload, ...JSON.parse(params[0]) };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('COUNT(*) AS cnt')) return { rows: [{ cnt: active }] };
    if (sql.includes('INSERT INTO daily_logs') || sql.includes('UPDATE daily_logs')) { reports.push(params); return { rows: [] }; }
    if (sql.includes('daily_logs')) return { rows: [] };
    if (sql.includes('COUNT(*) FILTER')) return { rows: [{ dispatched_today: 0, completed: 0, failed: 0, in_progress: 0 }] };
    throw new Error(`未声明的测试IO：${sql}`);
  });
  nightly = await import('../nightly-orchestrator.js');
});
afterEach(() => { nightly?.stopNightlyOrchestratorScheduler(); vi.useRealTimers(); });
describe('夜间已登记任务编排', () => {
  it('早报时点不生成日报DB或report事件，仍编排明确queued Task', async () => {
    nightly.startNightlyOrchestratorScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(reports).toEqual([]);
    expect(events.map(e => e.type)).toEqual(['nightly_orchestration_cycle']);
    expect(tasks[0].payload).toMatchObject({ dispatched_by_orchestrator: true, dispatched_orchestrator_date: '2026-11-16' });
    expect(tasks[0].status).toBe('queued');
    expect(nightly.getNightlyOrchestratorStatus().dispatched_tonight).toBe(1);
  });
  it('调度器不重复启动，持续周期不重标同日Task', async () => {
    expect(nightly.startNightlyOrchestratorScheduler()).toBe(true);
    expect(nightly.startNightlyOrchestratorScheduler()).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(events.filter(e => e.type === 'nightly_orchestration_cycle')).toHaveLength(1);
    expect(nightly.getNightlyOrchestratorStatus()).toMatchObject({ cycle_count: 2, dispatched_tonight: 1 });
    expect(reports).toEqual([]);
    expect(nightly.stopNightlyOrchestratorScheduler()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('容量已满时不标任务，释放容量后下一周期继续', async () => {
    active = 3;
    nightly.startNightlyOrchestratorScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(tasks[0].payload).toBeNull();
    active = 0;
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(tasks[0].payload?.dispatched_by_orchestrator).toBe(true);
    expect(events.map(e => e.type)).toEqual(['nightly_orchestration_cycle']);
  });
  it('一次IO失败后周期释放互斥并在下一次恢复编排', async () => {
    io.query.mockRejectedValueOnce(new Error('fixture-read-failed'));
    nightly.startNightlyOrchestratorScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(tasks[0].payload).toBeNull();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(tasks[0].payload?.dispatched_by_orchestrator).toBe(true);
    expect(events.map(e => e.type)).toEqual(['nightly_orchestration_cycle']);
    expect(reports).toEqual([]);
  });
});
