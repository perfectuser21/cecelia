/**
 * [BEHAVIOR] task_runs → Notion 投影面 pushTaskRuns（链 bf5088a3 棒1 PR B，任务 66db3dfb）。
 *
 * 血管注册制：库必须在 notion_projection_map 登记为 push+active 才推；未登记（Notion「Runs」库尚未建）
 * → 整个投影 flag-off 安全跳过，不查 task_runs、不打 Notion。
 * DB 为真相源：Notion 失败只记日志，不抛、不反向改 run 状态。
 * 缺列即补（复用 ops-notion-schema 的幂等补列模式）：Notion 缺列会 400，推送前先补。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mockNotionReq = vi.fn();
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../recurring-notion-sync.js', () => ({
  notionReq: (...a) => mockNotionReq(...a),
  getToken: () => 'fake-token',
}));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));

const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const RUN = {
  id: 'run-row-1',
  task_id: '22222222-2222-4222-8222-222222222222',
  run_id: 'notion-abc-1',
  status: 'success',
  started_at: '2026-09-25T02:00:00.000Z',
  ended_at: '2026-09-25T02:30:00.000Z',
  context: { source: 'ssh-workflow', machine: 'xian-mac-m4', wf_id: 'JinoHarvestDirect' },
  result: { exit_code: 0, artifacts: ['pr:1', 'cos://harvest/a.csv'] },
  error_message: null,
  notion_id: null,
  notion_digest: null,
  task_title: '[run] 金诺采收·直驾@xian-mac-m4',
};

function makePool({ registered }) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/FROM notion_projection_map/.test(text)) {
        return { rows: registered ? [{ notion_db_id: 'db-runs' }] : [] };
      }
      if (/FROM task_runs r/.test(text)) return { rows: [RUN] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  mockNotionReq.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('buildTaskRunNotionProperties — 开始/结束/exit/产物全在投影里', () => {
  it('完整 run：Name/Status/Source/TaskId/RunId/StartedAt/EndedAt/ExitCode/Artifacts/Minutes', async () => {
    const { buildTaskRunNotionProperties } = await import('../notion-push-sync.js');
    const p = buildTaskRunNotionProperties(RUN);
    expect(p.Name.title[0].text.content).toContain('金诺采收');
    expect(p.Status.select.name).toBe('success');
    expect(p.Source.select.name).toBe('ssh-workflow');
    expect(JSON.stringify(p.RunId)).toContain('notion-abc-1');
    expect(JSON.stringify(p.TaskId)).toContain(RUN.task_id);
    expect(p.StartedAt.date.start).toBe('2026-09-25T02:00:00.000Z');
    expect(p.EndedAt.date.start).toBe('2026-09-25T02:30:00.000Z');
    expect(p.ExitCode.number).toBe(0);
    expect(JSON.stringify(p.Artifacts)).toContain('cos://harvest/a.csv');
    expect(p.Minutes.number).toBe(30);
  });

  it('running 行不编造结束/exit/耗时（无 EndedAt / ExitCode / Minutes 键）', async () => {
    const { buildTaskRunNotionProperties } = await import('../notion-push-sync.js');
    const p = buildTaskRunNotionProperties({
      ...RUN, status: 'running', ended_at: null, result: {}, context: { source: 'executor' },
    });
    expect(p.Status.select.name).toBe('running');
    expect('EndedAt' in p).toBe(false);
    expect('ExitCode' in p).toBe(false);
    expect('Minutes' in p).toBe(false);
  });

  it('失败行带错误摘要', async () => {
    const { buildTaskRunNotionProperties } = await import('../notion-push-sync.js');
    const p = buildTaskRunNotionProperties({ ...RUN, status: 'failed', error_message: 'openclaw_agent_exit_2' });
    expect(JSON.stringify(p.Error)).toContain('openclaw_agent_exit_2');
  });
});

describe('pushTaskRuns — 注册表 flag + 缺列即补 + fail-open', () => {
  it('库未登记（pending_vessel 占位）→ 安全跳过：不查 task_runs、不打 Notion', async () => {
    const { pushTaskRunsForTest } = await import('../notion-push-sync.js');
    const pool = makePool({ registered: false });
    await pushTaskRunsForTest(pool, 'fake-token');
    expect(mockNotionReq).not.toHaveBeenCalled();
    expect(pool.calls.some((c) => /FROM task_runs/.test(c.sql))).toBe(false);
  });

  it('库已登记：先补缺列，再 POST 建页（parent=登记库），回写 notion_id/指纹', async () => {
    const { pushTaskRunsForTest } = await import('../notion-push-sync.js');
    const pool = makePool({ registered: true });
    mockNotionReq.mockImplementation(async (token, p, method) => {
      if (p === '/databases/db-runs' && method === 'GET') return { properties: { Name: { type: 'title' } } };
      if (p === '/pages' && method === 'POST') return { id: 'notion-page-1' };
      return {};
    });
    await pushTaskRunsForTest(pool, 'fake-token');

    const patchDb = mockNotionReq.mock.calls.find((c) => c[1] === '/databases/db-runs' && c[2] === 'PATCH');
    expect(patchDb).toBeTruthy();
    const added = Object.keys(patchDb[3].properties);
    expect(added).toEqual(expect.arrayContaining(['RunId', 'ExitCode', 'Artifacts', 'StartedAt', 'EndedAt', 'Status']));
    expect(added).not.toContain('Name'); // 已有列绝不重发（免覆盖人工调整）

    const post = mockNotionReq.mock.calls.find((c) => c[1] === '/pages' && c[2] === 'POST');
    expect(post[3].parent.database_id).toBe('db-runs');
    expect(post[3].properties.ExitCode.number).toBe(0);
    const writeBack = pool.calls.find((c) => /UPDATE task_runs SET notion_id/.test(c.sql));
    expect(writeBack.params).toContain('notion-page-1');
  });

  it('DB 为真相源：Notion 推送失败不抛、不改 run 状态，只回写记账列失败也不影响', async () => {
    const { pushTaskRunsForTest } = await import('../notion-push-sync.js');
    const pool = makePool({ registered: true });
    mockNotionReq.mockImplementation(async (token, p, method) => {
      if (method === 'GET') return { properties: {} };
      if (p === '/pages') throw new Error('Notion 500');
      return {};
    });
    await expect(pushTaskRunsForTest(pool, 'fake-token')).resolves.not.toThrow();
    expect(pool.calls.some((c) => /SET status|status\s*=/.test(c.sql) && /task_runs/.test(c.sql))).toBe(false);
  });
});

describe('接线钉子', () => {
  const src = readFileSync(path.join(BRAIN_ROOT, 'src/notion-push-sync.js'), 'utf8');
  it('runNotionPushSync 与运行舱专用入口 runOpsNotionPush 都调用 pushTaskRuns（吞错，不连坐）', () => {
    expect(src).toMatch(/async function pushTaskRuns\(pool, token\)/);
    expect(src).toMatch(/await pushTaskRuns\(pool, token\)/);
    const wired = src.match(/await pushTaskRunsSafe\(pool, token\)/g) || [];
    expect(wired.length).toBeGreaterThanOrEqual(2); // runNotionPushSync + runOpsNotionPush
  });
  it('投影读 task_runs 只 SELECT（写口唯一在 lib/task-run.js）', () => {
    expect(src).not.toMatch(/INSERT\s+INTO\s+task_runs/i);
    expect(src).not.toMatch(/UPDATE\s+task_runs/i);
  });
});

describe('Workflow真实关系与历史版本',()=>{
 it('关联真正Workflow/Task页，deferred与transport success分开，旧版本不伪造',async()=>{
  const {buildTaskRunNotionProperties}=await import('../notion-push-sync.js');
  const p=buildTaskRunNotionProperties({...RUN,workflow_page_id:'workflow-page',task_page_id:'task-page',
   script:{run_id:RUN.run_id,stdout:'{"status":"deferred","serial":"phone-1","source_revision":"old-sha"}'},
   context:{...RUN.context,attempt:2,workflow_snapshot:{batch_task_id:'batch'}}});
  expect(p.Workflow.relation).toEqual([{id:'workflow-page'}]);expect(p.Task.relation).toEqual([{id:'task-page'}]);
  expect(p['业务状态'].select.name).toBe('deferred');expect(p.Status.select.name).toBe('success');
  expect(JSON.stringify(p['流程版本'])).toContain('未知');expect(JSON.stringify(p['源码版本'])).toContain('old-sha');
  expect(JSON.stringify(p['设备'])).toContain('phone-1');expect(JSON.stringify(p['批次任务'])).toContain('batch');expect(p['尝试'].number).toBe(2);
 });
 it('最新任务回执不会污染旧尝试，冻结版本优先',async()=>{
  const {buildTaskRunNotionProperties}=await import('../notion-push-sync.js');
  const p=buildTaskRunNotionProperties({...RUN,script:{run_id:'new-run',stdout:'{"status":"deferred","source_revision":"new-sha"}'},
    context:{workflow_snapshot:{workflow_version:'0.1.0',source_revision:'frozen-sha'}}});
  expect(p['业务状态'].select.name).toBe('success');expect(JSON.stringify(p['源码版本'])).toContain('frozen-sha');expect(JSON.stringify(p['流程版本'])).toContain('0.1.0');
 });
 it('关联Workflow的已同步行仍轮转核对，按真实目录读取关系目标',async()=>{
  const {pushTaskRunsForTest}=await import('../notion-push-sync.js');
  mockNotionReq.mockResolvedValue({properties:{}});
  const pool=makePool({registered:true});await pushTaskRunsForTest(pool,'fake-token');
  const sql=pool.calls.find(c=>/FROM task_runs r/.test(c.sql)).sql;
  expect(sql).toContain('projection_links');expect(sql).toContain('notion-directory');expect(sql).toContain('notion_synced_at ASC');
  expect(pool.calls.some(c=>/FROM projection_targets/.test(c.sql))).toBe(true);
  expect(pool.calls.some(c=>/title = 'Tasks'/.test(c.sql))).toBe(true);
 });
});

it('Run关系schema使用正式库，保留已有错误目标并停止推送',async()=>{
 const {pushTaskRunsForTest}=await import('../notion-push-sync.js');
 const calls=[];const pool={query:vi.fn(async(sql,params)=>{
  calls.push({sql:String(sql),params});if(String(sql).includes('FROM projection_targets'))return {rows:[{config:{dbs:{workflows:'wf-db'}}}]};
  if(String(sql).includes("title = 'Tasks'"))return {rows:[{notion_db_id:'tasks-db'}]};
  if(String(sql).includes('FROM notion_projection_map'))return {rows:[{notion_db_id:'db-runs'}]};
  if(String(sql).includes('FROM task_runs r'))return {rows:[RUN]};return {rows:[]};
 })};
 mockNotionReq.mockImplementation(async(_t,p,method)=>{
  if(method==='GET')return {properties:{Workflow:{type:'relation',relation:{database_id:'wrong-db'}}}};
  return {};
 });
 await pushTaskRunsForTest(pool,'t');
 expect(mockNotionReq.mock.calls.some(c=>c[1]==='/pages')).toBe(false);
 expect(calls.some(c=>c.sql.includes('FROM task_runs r'))).toBe(false);
});
it('Run Error优先同身份结构化具体失败，成功不显示失败详情',async()=>{
 const {buildTaskRunNotionProperties}=await import('../notion-push-sync.js');
 const row={...RUN,status:'failed',error_message:'script_exit_255',result:{exit_code:255,business_receipt:{status:'failed',failure:{stage:'adb_connect',code:'ADB_UNREACHABLE',message:'device offline',evidence:['host:/tmp/probe.json']}}}};
 const content=buildTaskRunNotionProperties(row).Error.rich_text.map(t=>t.text.content).join('');
 expect(content).toContain('adb_connect');expect(content).toContain('ADB_UNREACHABLE');expect(content).toContain('device offline');expect(content).toContain('host:/tmp/probe.json');
 expect(buildTaskRunNotionProperties({...row,status:'success',error_message:null,result:{business_receipt:{status:'completed',failure:row.result.business_receipt.failure}}})).not.toHaveProperty('Error');
});
