vi.mock('../db.js', () => ({ default: { query: vi.fn(() => { throw new Error('禁止canonical DB'); }) } }));
import { describe, it, expect,vi } from 'vitest';
import { buildManualUpdateSql, runOpsNotionIngest } from '../ops-notion-ingest.js';

describe('buildManualUpdateSql — 只更新人工列', () => {
  it('生成的 SQL 只含人工列，绝不含机器列', () => {
    const { sql, values } = buildManualUpdateSql('ops_workflows', 'id-1', {
      owner_manual: '张三', priority_manual: 'P1', starred: true,
    });
    expect(sql).toContain('owner_manual');
    expect(sql).toContain('priority_manual');
    expect(sql).toContain('starred');
    expect(sql).not.toMatch(/run_total|success_rate|liveness|active\s*=/);
    expect(values).toEqual(['张三', 'P1', true, 'id-1']);
  });

  it('空改动 → 不生成 SQL（别做无谓写库）', () => {
    expect(buildManualUpdateSql('ops_workflows', 'id-1', {})).toBeNull();
  });

  it('未知字段被丢弃（防 Notion 上加个列就能往任意列写）', () => {
    const r = buildManualUpdateSql('ops_workflows', 'id-1', { owner_manual: 'x', run_total: 99999, active: false });
    expect(r.sql).toContain('owner_manual');
    expect(r.sql).not.toContain('run_total');
    expect(r.sql).not.toContain('active');
    expect(r.values).toEqual(['x', 'id-1']);
  });

  it('null 值能写进去（人清空字段要能落库）', () => {
    const r = buildManualUpdateSql('ops_agents', 'a-1', { owner_manual: null });
    expect(r.values).toEqual([null, 'a-1']);
  });

  it('表名白名单——非 ops_* 表一律拒绝', () => {
    expect(() => buildManualUpdateSql('tasks', 'x', { owner_manual: 'a' })).toThrow();
  });
});

describe('真实回读只记录人工列实际变化',()=>{
 it.each([['张三',false],['李四',true],[null,true]])('人工Owner=%s，实际变更=%s',async(owner,changed)=>{
  const query=vi.fn(async sql=>{
   if(sql.includes('ops_notion_dbs'))return {rows:[{value_json:{graph_db:'owned-agents'}}]};
   if(sql.startsWith('SELECT * FROM ops_agents'))return {rows:[{id:'agent-1',owner_manual:'张三'}]};
   return {rows:[]};
  });
  const notionReqFn=vi.fn(async()=>({results:[{id:'page-1',last_edited_time:'2026-11-04T00:00:00Z',properties:{Owner:{rich_text:owner?[{plain_text:owner}]:[]}}}]}));
  const result=await runOpsNotionIngest({query},{tokenFn:()=> 'owned-fixture',notionReqFn});
  expect(result).toMatchObject({ok:true,read:1,updated:changed?1:0,failed:0});
  const writes=query.mock.calls.filter(([sql])=>sql.startsWith('UPDATE ops_agents SET'));
  expect(writes).toHaveLength(changed?1:0);
  if(changed)expect(writes[0][1]).toEqual([owner,'agent-1']);
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO ops_notion_ingest_cursor'))).toBe(true);
 });
});

it('旧Enabled列不会启动n8n、写启停意图或假记执行成功，其他人工列仍回读', async () => {
  const target = { id: 'fixture-wf', wf_id: 'fixture-flow', source: 'n8n', active: true,
    enable_intent: null, owner_manual: '旧负责人' };
  const query = vi.fn(async sql => {
    if (sql.includes('ops_notion_dbs')) return { rows: [{ value_json: { workflows_db: 'fixture-db' } }] };
    if (sql.startsWith('SELECT * FROM ops_workflows')) return { rows: [{ ...target }] };
    return { rows: [] };
  });
  const page = properties => ({ id: 'fixture-page', last_edited_time: '2026-11-17T00:00:00Z', properties });
  const notionReqFn = vi.fn().mockResolvedValue({ results: [page({ Enabled: { checkbox: false } })] });
  const execFn = vi.fn();
  const options = { tokenFn: () => 'fixture-only', notionReqFn, execFn };
  expect(await runOpsNotionIngest({ query }, options)).toMatchObject({ ok: true, read: 1, updated: 0, failed: 0 });
  expect(execFn).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => /enable_intent|enable_applied_at|enable_error/.test(sql))).toBe(false);
  notionReqFn.mockResolvedValue({ results: [page({ Enabled: { checkbox: true }, Owner: { rich_text: [{ plain_text: '新负责人' }] } })] });
  expect(await runOpsNotionIngest({ query }, options)).toMatchObject({ ok: true, read: 1, updated: 1, failed: 0 });
  expect(query.mock.calls.some(([sql, params]) => sql.startsWith('UPDATE ops_workflows SET owner_manual') && params[0] === '新负责人')).toBe(true);
  expect(execFn).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => /enable_intent|enable_applied_at|enable_error/.test(sql))).toBe(false);
});

it('人工更新白名单不再接受任何旧n8n控制字段', () => {
  expect(buildManualUpdateSql('ops_workflows', 'id', { enable_intent: true, enable_applied_at: new Date(), enable_error: null })).toBeNull();
});
