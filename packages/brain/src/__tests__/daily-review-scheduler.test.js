/**
 * daily-review-scheduler.test.js
 * 每日代码审查调度器完整单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../actions.js', () => ({ createTask: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
import { createTask } from '../actions.js';
import {
  isInDailyWindow,
  isInContractScanWindow,
  hasTodayReview,
  hasTodayContractScan,
  createCodeReviewTask,
  getActiveRepoPaths,
  triggerDailyReview,
  triggerContractScan,
  isInArchReviewWindow,
  hasRecentArchReview,
  hasCompletedDevTaskSinceLastArchReview,
  triggerArchReview,
} from '../daily-review-scheduler.js';

// ============================================================
// isInDailyWindow（每日代码审查触发窗口 02:00-02:05 UTC）
// ============================================================
describe('isInDailyWindow', () => {
  it('02:00 UTC 触发', () => {
    const d = new Date('2026-02-24T02:00:00Z');
    expect(isInDailyWindow(d)).toBe(true);
  });

  it('02:04 UTC 仍在窗口内', () => {
    const d = new Date('2026-02-24T02:04:00Z');
    expect(isInDailyWindow(d)).toBe(true);
  });

  it('02:04:59 UTC 仍在窗口内', () => {
    const d = new Date('2026-02-24T02:04:59Z');
    expect(isInDailyWindow(d)).toBe(true);
  });

  it('02:05 UTC 超出窗口', () => {
    const d = new Date('2026-02-24T02:05:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('其他时间不触发（10:30）', () => {
    const d = new Date('2026-02-24T10:30:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('01:59 UTC 不触发', () => {
    const d = new Date('2026-02-24T01:59:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('00:00 UTC 不触发', () => {
    const d = new Date('2026-02-24T00:00:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('03:00 UTC 不触发（契约扫描窗口，不是代码审查窗口）', () => {
    const d = new Date('2026-02-24T03:00:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('23:59 UTC 不触发', () => {
    const d = new Date('2026-02-24T23:59:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('不传参时使用当前时间（不抛错）', () => {
    // 只验证不抛异常，返回布尔值
    const result = isInDailyWindow();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================
// isInContractScanWindow（契约扫描触发窗口 03:00-03:05 UTC）
// ============================================================
describe('isInContractScanWindow', () => {
  it('03:00 UTC 触发', () => {
    const d = new Date('2026-03-05T03:00:00Z');
    expect(isInContractScanWindow(d)).toBe(true);
  });

  it('03:04 UTC 仍在窗口内', () => {
    const d = new Date('2026-03-05T03:04:00Z');
    expect(isInContractScanWindow(d)).toBe(true);
  });

  it('03:05 UTC 超出窗口', () => {
    const d = new Date('2026-03-05T03:05:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('02:00 UTC 不触发（代码审查窗口，不是契约扫描窗口）', () => {
    const d = new Date('2026-03-05T02:00:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('10:30 UTC 不触发', () => {
    const d = new Date('2026-03-05T10:30:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('不传参时使用当前时间（不抛错）', () => {
    const result = isInContractScanWindow();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================
// hasTodayReview
// ============================================================
describe('hasTodayReview', () => {
  it('今天已有 review，返回 true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'abc' }] }) };
    const result = await hasTodayReview(pool, '/home/xx/perfect21/cecelia');
    expect(result).toBe(true);
  });

  it('今天无 review，返回 false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await hasTodayReview(pool, '/home/xx/perfect21/cecelia');
    expect(result).toBe(false);
  });

  it('SQL 查询包含 code_review task_type 和 repo_path 参数', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await hasTodayReview(pool, '/some/path');
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toContain("task_type = 'code_review'");
    expect(sql).toContain("payload->>'repo_path'");
    expect(params).toEqual(['/some/path']);
  });

  it('数据库查询失败时抛出错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB connection refused')) };
    await expect(hasTodayReview(pool, '/some/path')).rejects.toThrow('DB connection refused');
  });
});

// ============================================================
// hasTodayContractScan
// ============================================================
describe('hasTodayContractScan', () => {
  it('今天已有 contract-scan 任务，返回 true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'cs-1' }] }) };
    const result = await hasTodayContractScan(pool);
    expect(result).toBe(true);
  });

  it('今天无 contract-scan 任务，返回 false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await hasTodayContractScan(pool);
    expect(result).toBe(false);
  });

  it('SQL 查询包含 task_type=dev 和 created_by=contract-scan', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await hasTodayContractScan(pool);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("task_type = 'dev'");
    expect(sql).toContain("created_by = 'contract-scan'");
  });

  it('数据库查询失败时抛出错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB timeout')) };
    await expect(hasTodayContractScan(pool)).rejects.toThrow('DB timeout');
  });
});

// ============================================================
// getActiveRepoPaths
// ============================================================
describe('getActiveRepoPaths', () => {
  it('从 DB 返回 repo 列表', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { repo_path: '/home/xx/perfect21/cecelia' },
          { repo_path: '/home/xx/perfect21/zenithjoy/workspace' },
        ],
      }),
    };
    const paths = await getActiveRepoPaths(pool);
    expect(paths).toEqual([
      '/home/xx/perfect21/cecelia',
      '/home/xx/perfect21/zenithjoy/workspace',
    ]);
  });

  it('DB 返回空时给出空数组', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const paths = await getActiveRepoPaths(pool);
    expect(paths).toEqual([]);
  });

  it('SQL 查询过滤 NULL 和空字符串的 repo_path（新 OKR 表 metadata）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await getActiveRepoPaths(pool);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("repo_path' IS NOT NULL");
    expect(sql).toContain("repo_path' != ''");
  });

  it('数据库查询失败时抛出错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('query failed')) };
    await expect(getActiveRepoPaths(pool)).rejects.toThrow('query failed');
  });
});

// ============================================================
// createCodeReviewTask
// ============================================================
const db = (...rows) => ({ query: vi.fn().mockImplementation(async () => {
  if (!rows.length) throw new Error('unexpected SQL');
  const next = rows.shift();
  if (next instanceof Error) throw next;
  return { rows: next };
}) });
beforeEach(() => { createTask.mockReset(); createTask.mockResolvedValue({ task: { id: 'created' } }); });

describe('createCodeReviewTask — unified task boundary', () => {
  it('deduplicates without invoking creator', async () => {
    expect(await createCodeReviewTask(db([{id:'existing'}]), '/repo/a')).toEqual({created:false,reason:'already_today',repo_path:'/repo/a'});
    expect(createTask).not.toHaveBeenCalled();
  });
  it('creates the scoped review through createTask', async () => {
    const pool = db([]);
    expect(await createCodeReviewTask(pool, '/repo/a')).toEqual({created:true,task_id:'created',repo_path:'/repo/a'});
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      db:pool, source:'scheduler', source_id:expect.stringMatching(/^daily-code-review:\/repo\/a:\d{4}-\d{2}-\d{2}$/),
      title:expect.stringMatching(/^\[code-review\] a \d{4}-\d{2}-\d{2}$/),task_type:'code_review',priority:'P2',
      created_by:'cecelia-brain',trigger_source:'brain_auto',allow_unscoped:true,
      payload:{repo_path:'/repo/a',since_hours:24,scope:'daily'}
    }));
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('propagates dedup failure', async () => {
    await expect(createCodeReviewTask(db(new Error('dedup failed')), '/a')).rejects.toThrow('dedup failed');
    expect(createTask).not.toHaveBeenCalled();
  });
  it('propagates creator failure', async () => {
    createTask.mockRejectedValueOnce(new Error('create failed'));
    await expect(createCodeReviewTask(db([]), '/a')).rejects.toThrow('create failed');
  });
});

describe('triggerDailyReview', () => {
  const now = new Date('2026-02-24T02:01:00Z');
  it('outside window performs no IO', async () => {
    const pool=db();
    expect(await triggerDailyReview(pool,new Date('2026-02-24T10:00:00Z'))).toEqual({triggered:0,skipped:0,skipped_window:true,results:[]});
    expect(pool.query).not.toHaveBeenCalled(); expect(createTask).not.toHaveBeenCalled();
  });
  it('creates each repo, preserves dedup and returned identity', async () => {
    createTask.mockResolvedValueOnce({task:{id:'b'}}).mockResolvedValueOnce({task:{id:'c'}});
    const result=await triggerDailyReview(db([{repo_path:'/a'},{repo_path:'/b'},{repo_path:'/c'}],[{id:'old'}],[],[]),now);
    expect(result).toMatchObject({triggered:2,skipped:1,skipped_window:false,results:[{created:false,reason:'already_today'},{created:true,task_id:'b'},{created:true,task_id:'c'}]});
    expect(createTask.mock.calls.map(([x])=>x.payload.repo_path)).toEqual(['/b','/c']);
  });
  it('empty repo list creates every fallback repo', async () => {
    const pool={query:vi.fn().mockResolvedValue({rows:[]})};
    const result=await triggerDailyReview(pool,now);
    expect(result.triggered).toBe(6); expect(result.results).toHaveLength(6);
    expect(new Set(createTask.mock.calls.map(([x])=>x.payload.repo_path)).size).toBe(6);
  });
  it('repo lookup failure does not create tasks', async () => {
    expect(await triggerDailyReview(db(new Error('lookup')),now)).toMatchObject({triggered:0,results:[]});
    expect(createTask).not.toHaveBeenCalled();
  });
  it('creator error is contained', async () => {
    createTask.mockRejectedValueOnce(new Error('create failed'));
    expect(await triggerDailyReview(db([{repo_path:'/a'}],[]),now)).toMatchObject({triggered:0,skipped:0,results:[]});
  });
});

describe('triggerContractScan', () => {
  it('outside window never spawns', async () => {
    const spawn=vi.fn();const pool=db();
    expect(await triggerContractScan(pool,new Date('2026-01-01T02:00Z'),spawn)).toMatchObject({triggered:false,skipped_window:true});
    expect(pool.query).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();
  });
  it('deduplicates without spawning',async()=>{
    const spawn=vi.fn();
    expect(await triggerContractScan(db([{id:'old'}]),new Date('2026-01-01T03:01Z'),spawn)).toMatchObject({triggered:false,skipped_today:true});
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each([[],new Error('dedup down')])('spawns isolated boundary on eligible scan %s',async rows=>{
    const unref=vi.fn(); const spawn=vi.fn(()=>({unref}));
    expect(await triggerContractScan(db(rows),new Date('2026-01-01T03:01Z'),spawn)).toMatchObject({triggered:true});
    expect(spawn).toHaveBeenCalledWith('node',[expect.stringMatching(/run-contract-scan\.mjs$/)],expect.objectContaining({detached:true,stdio:'ignore'}));
    expect(unref).toHaveBeenCalledOnce();
  });
});

describe('arch review guards and routing',()=>{
  const now=new Date('2026-01-01T04:01Z');
  it.each([0,4,8,12,16,20])('hour %s is eligible',h=>{
    expect(isInArchReviewWindow(new Date(Date.UTC(2026,0,1,h,4)))).toBe(true);
    expect(isInArchReviewWindow(new Date(Date.UTC(2026,0,1,h,5)))).toBe(false);
  });
  it('other hours are ineligible',()=>expect(isInArchReviewWindow(new Date('2026-01-01T03:01Z'))).toBe(false));
  it.each([[[],false],[[{id:'old'}],true]])('recent review detection %j',async(rows,expected)=>expect(await hasRecentArchReview(db(rows))).toBe(expected));
  it('no historical review allows first run',async()=>expect(await hasCompletedDevTaskSinceLastArchReview(db([]))).toBe(true));
  it.each([[[],false],[[{id:'dev'}],true]])('completed dev guard %j',async(rows,expected)=>{
    const pool=db([{created_at:'last'}],rows);
    expect(await hasCompletedDevTaskSinceLastArchReview(pool)).toBe(expected);
    expect(pool.query.mock.calls[1][1]).toEqual(['last']);
  });
  it('outside window performs no IO',async()=>{
    const pool=db();expect(await triggerArchReview(pool,new Date('2026-01-01T03:01Z'))).toMatchObject({triggered:false,skipped_window:true});
    expect(pool.query).not.toHaveBeenCalled();expect(createTask).not.toHaveBeenCalled();
  });
  it('recent review blocks creation',async()=>{
    expect(await triggerArchReview(db([{id:'old'}]),now)).toMatchObject({triggered:false,skipped_recent:true});expect(createTask).not.toHaveBeenCalled();
  });
  it('no new completed dev blocks creation',async()=>{
    expect(await triggerArchReview(db([],[{created_at:'last'}],[]),now)).toMatchObject({triggered:false,skipped_guard:true});expect(createTask).not.toHaveBeenCalled();
  });
  it('routes arch_review and includes real ledger digest',async()=>{
    const pool=db([],[],[{title:'line one',content:'observed facts'}]);
    expect(await triggerArchReview(pool,now)).toMatchObject({triggered:true,task_id:'created'});
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({db:pool,task_type:'arch_review',source:'scheduler',source_id:'arch-review:2026-01-01T04',priority:'P2',payload:expect.objectContaining({scope:'scheduled',trigger:'4h',prd_summary:expect.stringContaining('### line one\nobserved facts')})}));
  });
  it('guard DB failures retain current fail-open policy',async()=>{
    expect(await triggerArchReview(db(new Error('dedup'),new Error('guard'),[]),now)).toMatchObject({triggered:true});
  });
  it('ledger failure does not block review',async()=>{
    expect(await triggerArchReview(db([],[],new Error('ledger')),now)).toMatchObject({triggered:true});
  });
  it('creator failure is observable',async()=>{
    createTask.mockRejectedValueOnce(new Error('constraint failed'));
    expect(await triggerArchReview(db([],[],[]),now)).toMatchObject({triggered:false,error:'constraint failed'});
  });
});
