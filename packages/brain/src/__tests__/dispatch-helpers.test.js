/**
 * dispatch-helpers.test.js — selectNextDispatchableTask headed_manual 派发排除单测
 * （task 94ee0ec4，铁律 9f14c074，decisions 拍板 433fb902）。
 *
 * headed_manual=true（jsonb 布尔或字符串 'true'，payload->> 均返回文本 'true'）的任务
 * 留给有头人工执行，不进无头自动派发——排除在 SQL 谓词层收窄（NFR：不放宽基底谓词）。
 * 真实 DB 行为由 liveness-queued-never-spawned E2E（replay-incident.sh）在真目标验证，
 * 本单测锁 SQL 谓词与基本选择流程。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn(() => ({ p2_paused: true })),
}));

vi.mock('../actions.js', () => ({
  updateTask: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('../task-weight.js', () => ({
  sortTasksByWeight: vi.fn((rows) => rows),
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
}));

vi.mock('../slot-allocator.js', () => ({
  shouldBypassBackpressure: vi.fn(() => false),
}));

describe('selectNextDispatchableTask — headed_manual 派发排除', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('候选 SQL 谓词排除 payload.headed_manual=true（收窄谓词存在且语义正确）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');

    const result = await selectNextDispatchableTask(null, []);

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalled();
    const sql = mockQuery.mock.calls[0][0];
    // 基底谓词不放宽：仍以 status='queued' 为基底
    expect(sql).toContain("t.status = 'queued'");
    // headed_manual 排除谓词：jsonb 布尔与字符串 'true' 均被 payload->> 归一为文本 'true'
    expect(sql).toContain("COALESCE(t.payload->>'headed_manual', 'false') <> 'true'");
  });

  it('候选 SQL 谓词排除 payload.parallel_worker=true（worker 池专属,禁 kernel tick 抢单)', async () => {
    // 案卷 09-06:金丝雀 d8963868 挂 parallel_worker:true 入队,kernel tick(2min)抢在
    // worker-pool job(5min gate)前叼走——两个派发器猎同一个池。修法同 headed_manual:谓词层收窄。
    mockQuery.mockResolvedValue({ rows: [] });
    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');

    await selectNextDispatchableTask(null, []);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("COALESCE(t.payload->>'parallel_worker', 'false') <> 'true'");
  });

  it('无 headed 旗标任务正常入选（排除只收窄不误伤）', async () => {
    const task = {
      id: 'task-normal-1',
      title: '普通任务',
      status: 'queued',
      priority: 'P1',
      payload: {},
      task_type: 'dev',
    };
    mockQuery.mockResolvedValue({ rows: [task] });
    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');

    const result = await selectNextDispatchableTask(null, []);

    expect(result).toEqual(task);
  });
});

describe('正规代码候选隔离',()=>{
 it('codeOnly 查询校验正式定义，保留硬依赖与人工标记',async()=>{
 mockQuery.mockResolvedValue({rows:[]});const {selectNextDispatchableTask}=await import('../dispatch-helpers.js');
 await selectNextDispatchableTask(null,[],{codeOnly:true,onlyTaskTypes:['script_run']});
 const sql=mockQuery.mock.calls.at(-1)[0];expect(sql).toContain("workflow.status = 'active'");
 expect(sql).toContain("t.payload->'runtime_requires_llm' = 'false'::jsonb");expect(sql).toContain('task_dependencies');
 expect(sql).toContain("COALESCE(t.payload->>'headed_manual', 'false') <> 'true'");
 expect(sql).not.toContain('t2.project_id = t.project_id');
 });
 it('明确代码的 P2 不受 AI P2 降级影响，仍查 payload.depends_on',async()=>{
 const code={id:'code1',priority:'P2',task_type:'script_run',payload:{runtime_requires_llm:false,workflow_id:'wf',depends_on:['dep1']}};
 mockQuery.mockImplementation(async sql=>sql.includes('SELECT COUNT(*)')?{rows:[{count:1}]}:{rows:[code]});
 const {selectNextDispatchableTask}=await import('../dispatch-helpers.js');
 expect(await selectNextDispatchableTask(null,[],{codeOnly:true})).toBeNull();
 expect(mockQuery.mock.calls.some(([sql])=>sql.includes('SELECT COUNT(*)'))).toBe(true);
 });
});
