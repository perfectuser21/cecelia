import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { query, isConsciousnessEnabled } = vi.hoisted(() => ({
  query: vi.fn(), isConsciousnessEnabled: vi.fn(),
}));
vi.mock('../packages/brain/src/db.js', () => ({ default: { query } }));
vi.mock('../packages/brain/src/auto-fix.js', () => ({ shouldAutoFix: vi.fn(), dispatchToDevSkill: vi.fn() }));
vi.mock('../packages/brain/src/alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../packages/brain/src/consciousness-guard.js', () => ({
  isConsciousnessEnabled, setConsciousnessEnabled: vi.fn(), getConsciousnessStatus: () => ({ env_override: false }),
}));
vi.mock('../packages/brain/src/rumination.js', () => ({ runRumination: vi.fn(async () => ({ digested: 0 })) }));
vi.mock('../packages/brain/src/consciousness-loop.js', () => ({ startConsciousnessLoop: vi.fn() }));
vi.mock('child_process', () => ({ spawnSync: vi.fn(() => { throw new Error('unexpected subprocess'); }) }));
import { PROBES } from '../packages/brain/src/capability-probe.js';
const probe = PROBES.find(p => p.name === 'rumination').fn;
let state;
beforeEach(() => {
  state={archive:0,last:null,pending:2,outputs:0,lastEvent:null,heartbeat:0,invoke:0,consciousness:null,tick:null};
  isConsciousnessEnabled.mockReset().mockReturnValue(true);
  vi.stubEnv('BRAIN_MINIMAL_MODE', 'false');
  query.mockReset();
  query.mockImplementation(async sql => {
    if(sql.includes('FROM synthesis_archive')) return {rows:[sql.includes('max(')?{last_run:state.last}:{cnt:String(state.archive)}]};
    if(sql.includes('FROM learnings')) return {rows:[{cnt:String(state.pending)}]};
    if(sql.includes("event_type = 'rumination_output'")) return {rows:[{cnt:String(state.outputs),last_event:state.lastEvent}]};
    if(sql.includes("event_type = 'rumination_run'")) return {rows:[{cnt:String(state.heartbeat)}]};
    if(sql.includes("event_type = 'rumination_invoke'")) return {rows:[{cnt:String(state.invoke)}]};
    if(sql.includes("event_type = 'rumination_llm_failure'")) return {rows:[{payload:{notebook_error:'nb down',llm_error:'llm down'}}]};
    if(sql.includes("key = 'consciousness_enabled'")) return {rows:state.consciousness ? [{value_json:state.consciousness}] : []};
    if(sql.includes("key = 'tick_last'")) return {rows:state.tick ? [{value_json:{timestamp:state.tick}}] : []};
    throw new Error(`unexpected query: ${sql}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
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
    expect(result.detail).toContain(`heartbeats_24h=${heartbeat}`);
    expect(result.detail).toContain(`invocations_24h=${invoke}`);
    for(const event of ['rumination_run','rumination_invoke']) {
      const sql=query.mock.calls.find(([sql])=>sql.includes(`event_type = '${event}'`))[0];
      expect(sql).toContain("INTERVAL '24 hours'");
    }
    if(heartbeat) {
      expect(result.detail).toContain('last_llm_failure: notebook=nb down llm=llm down');
      const sql=query.mock.calls.find(([sql])=>sql.includes("event_type = 'rumination_llm_failure'"))[0];
      expect(sql).toMatch(/ORDER BY created_at DESC\s+LIMIT 1/);
    }
  });
  it.each([
    [true, {enabled:false}, 'enabled'],
    [false, {enabled:false}, 'DISABLED(db)'],
    [false, {enabled:true}, 'DISABLED(env_override)'],
    [false, null, 'DISABLED(env_override)'],
  ])('loop_dead 使用实际意识守卫值 %s 和数据库值 %j 诊断来源', async(enabled, dbValue, label)=>{
    isConsciousnessEnabled.mockReturnValue(enabled);
    state.consciousness=dbValue;
    expect(await probe()).toEqual({ok:false, detail:
      `48h_count=0 last_run=never undigested=2 recent_outputs=0 heartbeats_24h=0 invocations_24h=0 (loop_dead) consciousness=${label} last_tick=never`});
    expect(isConsciousnessEnabled).toHaveBeenCalledOnce();
  });
  it.each(['true', 'false'])('minimal mode=%s 与 working_memory tick 时间真实输出', async(mode)=>{
    vi.stubEnv('BRAIN_MINIMAL_MODE', mode);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T00:10:00Z'));
    state.tick='2026-11-25T00:03:00Z';
    const {detail}=await probe();
    expect(detail).toContain('last_tick=2026-11-25T00:03:00Z(7min_ago)');
    expect(detail.includes('minimal_mode=ENABLED(blocks_rumination)')).toBe(mode==='true');
    if(mode==='true') expect(detail).toContain('minimal_mode=ENABLED(blocks_rumination) consciousness=enabled');
  });
  it('48h 无产出仍透出历史全局 last_run，不能误报 never', async()=>{
    state.last='2026-10-01T00:00:00Z';
    const {detail}=await probe();
    expect(detail).toContain('last_run=2026-10-01T00:00:00Z');
    const lastQuery=query.mock.calls.find(([sql])=>sql.includes('max(created_at) AS last_run'))[0];
    expect(lastQuery).not.toMatch(/WHERE|INTERVAL/i);
  });
  it.each([
    [null, '2026-11-24T00:00:00Z', '2026-11-24T00:00:00Z'],
    ['2026-10-01T00:00:00Z', '2026-11-24T00:00:00Z', '2026-10-01T00:00:00Z'],
    [null, null, 'never'],
  ])('output 活跃时 last_run=%s last_event=%s 保留真实优先级', async(last, lastEvent, expectedLast)=>{
    Object.assign(state,{outputs:2,last,lastEvent});
    expect(await probe()).toEqual({ok:true,detail:
      `48h_count=0 last_run=${expectedLast} undigested=2 (running: recent_outputs=2 last_event=${lastEvent})`});
    expect(isConsciousnessEnabled).not.toHaveBeenCalled();
  });
  it('主查询失败必须拒绝，不能假通过',async()=>{
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(probe()).rejects.toThrow('database unavailable');
  });
});
