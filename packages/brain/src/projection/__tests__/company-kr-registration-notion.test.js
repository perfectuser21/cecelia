import { describe, it, expect, vi } from 'vitest';
import { upsertRegistrationPage, workflowProperties, stepProperties, runProperties } from '../company-kr-registration-notion.js';

describe('公司KR登记投影', () => {
  it('正式workflow和步骤关系使用实际ID；历史run不捏造步骤完成关系', () => {
    expect(workflowProperties({name:'公司 KR 分析',version:'1.0'}).Workflow.title[0].text.content).toBe('公司 KR 分析');
    expect(stepProperties({key:'k',step_order:2,readback:{name:'读取目标',implementation:'ref'}}, 'wf')['所属Workflow'].relation).toEqual([{id:'wf'}]);
    const p=runProperties({run_id:'r',status:'success',started_at:'2026-10-01T00:00:00Z',ended_at:'2026-10-01T00:01:00Z'},'ops');
    expect(p.Workflow.relation).toEqual([{id:'ops'}]);
    expect(p).not.toHaveProperty('涉及步骤');
    expect(p.Status.select.name).toBe('success');
  });
  it('投影存在重复页时停止，不再创建第三份', async () => {
    const pool={query:vi.fn().mockResolvedValue({rows:[]})};
    const notionReq=vi.fn().mockResolvedValue({results:[{id:'a'},{id:'b'}]});
    await expect(upsertRegistrationPage(pool,'token',{table:'steps',row:{id:'s'},dbId:'db',properties:{},filter:{},notionReq})).rejects.toThrow('重复');
    expect(notionReq).toHaveBeenCalledTimes(1);
    expect(notionReq.mock.calls[0][1]).toContain('/query');
  });
  it('丢失本地映射时按稳定身份找回旧页，不重复POST', async () => {
    const pool={query:vi.fn().mockResolvedValue({rows:[]})};
    const notionReq=vi.fn().mockResolvedValueOnce({results:[{id:'old'}]}).mockResolvedValueOnce({id:'old'});
    expect(await upsertRegistrationPage(pool,'token',{table:'steps',row:{id:'s'},dbId:'db',properties:{},filter:{},notionReq})).toBe('old');
    expect(notionReq.mock.calls[1].slice(1,3)).toEqual(['/pages/old','PATCH']);
    expect(pool.query.mock.calls.at(-1)[1]).toContain('old');
  });
  it('其它entity已占用的同名页在任何PATCH前拒绝，不先污染再报错',async()=>{
    const pool={query:vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{entity_type:'steps',entity_id:'other'}]})};
    const notionReq=vi.fn().mockResolvedValue({results:[{id:'occupied'}]});
    await expect(upsertRegistrationPage(pool,'token',{table:'steps',row:{id:'mine'},dbId:'db',properties:{},filter:{},notionReq})).rejects.toThrow('归属');
    expect(notionReq).toHaveBeenCalledTimes(1);
  });
  it('同名未映射页没有登记身份时拒绝接管',async()=>{
    const pool={query:vi.fn().mockResolvedValue({rows:[]})};
    const notionReq=vi.fn().mockResolvedValue({results:[{id:'unknown'}]});
    await expect(upsertRegistrationPage(pool,'token',{table:'steps',row:{id:'mine'},dbId:'db',properties:{},filter:{},verifyRecovered:()=>false,notionReq})).rejects.toThrow('身份');
    expect(notionReq).toHaveBeenCalledTimes(1);
  });
  it('Notion失败不落成功映射',async()=>{
    const pool={query:vi.fn().mockResolvedValue({rows:[]})};
    const notionReq=vi.fn().mockResolvedValueOnce({results:[]}).mockRejectedValueOnce(Error('503'));
    await expect(upsertRegistrationPage(pool,'token',{table:'steps',row:{id:'s'},dbId:'db',properties:{},filter:{},notionReq})).rejects.toThrow('503');
    expect(pool.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
  });

});
