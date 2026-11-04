import { beforeEach, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../packages/brain/src/db.js', () => ({ default: { query } }));
vi.mock('../packages/brain/src/auto-fix.js', () => ({ shouldAutoFix: vi.fn(), dispatchToDevSkill: vi.fn() }));
vi.mock('../packages/brain/src/alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../packages/brain/src/consciousness-guard.js', () => ({
  isConsciousnessEnabled: () => true, setConsciousnessEnabled: vi.fn(), getConsciousnessStatus: () => ({ env_override: false }),
}));
vi.mock('../packages/brain/src/rumination.js', () => ({ runRumination: vi.fn(async () => ({ digested: 0 })) }));
vi.mock('../packages/brain/src/consciousness-loop.js', () => ({ startConsciousnessLoop: vi.fn() }));
vi.mock('child_process', () => ({ spawnSync: vi.fn(() => { throw new Error('unexpected subprocess'); }) }));
import { PROBES } from '../packages/brain/src/capability-probe.js';
const probe = PROBES.find(p => p.name === 'rumination').fn;
let state;
beforeEach(() => {
  state={archive:0,last:null,pending:2,outputs:0,heartbeat:0,invoke:0};
  query.mockReset();
  query.mockImplementation(async sql => {
    if(sql.includes('FROM synthesis_archive')) return {rows:[sql.includes('max(')?{last_run:state.last}:{cnt:String(state.archive)}]};
    if(sql.includes('FROM learnings')) return {rows:[{cnt:String(state.pending)}]};
    if(sql.includes("event_type = 'rumination_output'")) return {rows:[{cnt:String(state.outputs),last_event:'2026-11-04T00:00:00Z'}]};
    if(sql.includes("event_type = 'rumination_run'")) return {rows:[{cnt:String(state.heartbeat)}]};
    if(sql.includes("event_type = 'rumination_invoke'")) return {rows:[{cnt:String(state.invoke)}]};
    if(sql.includes("event_type = 'rumination_llm_failure'")) return {rows:[{payload:{notebook_error:'nb down',llm_error:'llm down'}}]};
    if(sql.includes('FROM working_memory')) return {rows:[]};
    throw new Error(`unexpected query: ${sql}`);
  });
});
describe('真实 rumination probe 行为（无循环、模型、通知或回滚）',()=>{
  it('近期合成通过且报告真实最后时间',async()=>{
    state.archive=3;state.last='2026-11-03';
    expect(await probe()).toMatchObject({ok:true,detail:'48h_count=3 last_run=2026-11-03'});
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("INTERVAL '48 hours'");
  });
  it('无待消化内容属于正常空闲',async()=>{
    state.pending=0;
    expect(await probe()).toMatchObject({ok:true,detail:expect.stringContaining('idle: no_pending_learnings')});
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('近期 output 足以证明活跃，无需 72h 合成记录',async()=>{
    state.outputs=2;
    expect(await probe()).toMatchObject({ok:true,detail:expect.stringContaining('running: recent_outputs=2')});
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).toContain("INTERVAL '24 hours'");
  });
  it.each([[0,0,'loop_dead'],[0,1,'invoke_no_digest'],[1,1,'degraded_llm_failure']])('无 output 时真实故障 heartbeat=%s invoke=%s',async(heartbeat,invoke,tag)=>{
    Object.assign(state,{heartbeat,invoke});
    const result=await probe();
    expect(result.ok).toBe(false);expect(result.detail).toContain(tag);
    expect(result.detail).toContain('undigested=2');
    if(heartbeat) expect(result.detail).toContain('llm down');
  });
  it('主查询失败必须拒绝，不能假通过',async()=>{
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(probe()).rejects.toThrow('database unavailable');
  });
});
