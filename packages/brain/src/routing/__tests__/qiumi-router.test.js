/** 原生决策落库：保payload/真列、停放与queued人控CAS合同。 */
import {it,expect,vi} from 'vitest';
import {persistDecision} from '../qiumi-router.js';
const task=()=>({id:'10000000-0000-4000-8000-000000000001',status:'queued'});
it('agent → 只 merge payload（model/provider/run_id），不动 task_type/status', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), {
      outcome: 'agent', engine: 'native-agent', model: 'openai/gpt-6.2-sol', department: 'dev', kind: 'agent',
      workflowRef: null, runId: 'qiumi-11111111-2',
      payloadPatch: { model: 'openai/gpt-6.2-sol', provider: 'native-agent', run_id: 'qiumi-11111111-2', qiumi_route: {} },
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET payload = COALESCE\(payload, '\{\}'::jsonb\) \|\| \$2::jsonb/);
    expect(sql).not.toMatch(/task_type|status/);
    expect(JSON.parse(params[1])).toMatchObject({ model: 'openai/gpt-6.2-sol', run_id: 'qiumi-11111111-2' });
  });

it('fail → status=failed + error_message + 释放 claim（只在 queued 时）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), { outcome: 'fail', reason: 'device_uncertain', detail: 'p=0.5' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET status = 'failed'/);
    expect(sql).toMatch(/claimed_by = NULL/);
    expect(sql).toMatch(/AND status = 'queued'/);
    expect(params[1]).toBe('device_uncertain: p=0.5');
  });

it('agent决策同一条UPDATE写kind/dept与设备提示，不产生子任务',async()=>{
 const query=vi.fn(async()=>({rows:[],rowCount:1}));
 const decision={outcome:'agent',kind:'agent',department:'main',payloadPatch:{provider:'native-agent',qiumi_route:{source:'native-agent',device_hint:{serial:'fixture-phone'}}}};
 await persistDecision({query},task(),decision);
 expect(query).toHaveBeenCalledOnce();const [sql,args]=query.mock.calls[0];
 expect(sql).toContain('kind = $3');expect(sql).toContain('dept = $4');
 expect(args.slice(2)).toEqual(['agent','main']);
 expect(JSON.parse(args[1]).qiumi_route.device_hint.serial).toBe('fixture-phone');
 expect(sql).not.toMatch(/INSERT|task_type|status/);
});
it('设备未唯一定案停放候选、清claim、无限期等待人控且CAS只认queued',async()=>{
 const query=vi.fn(async()=>({rows:[],rowCount:1}));
 const d={outcome:'unresolved',detail:{reason:'native_device_identity_required',candidates:['a','b']},note:'明确指定设备'};
 await persistDecision({query},task(),d);const [sql,args]=query.mock.calls[0];
 for(const value of ["status = 'blocked'","blocked_reason = 'device_unresolved'",'blocked_until = NULL','claimed_by = NULL',"WHERE id = $1 AND status = 'queued'"])expect(sql).toContain(value);
 expect(JSON.parse(args[1])).toEqual(d.detail);expect(args[2]).toBe(d.note);
});
it('缺完整正文等原生准入阻塞保留blocked原因，不失败或自动释放',async()=>{
 const query=vi.fn(async()=>({rows:[],rowCount:1}));
 await persistDecision({query},task(),{outcome:'blocked',reason:'native_agent_body_incomplete'});
 const [sql,args]=query.mock.calls[0];
 expect(sql).toContain("status='blocked'");expect(sql).toContain("status='queued'");expect(sql).toContain('blocked_until=NULL');
 expect(args).toEqual([task().id,'native_agent_body_incomplete']);
});
