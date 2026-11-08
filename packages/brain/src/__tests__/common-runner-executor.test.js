import { describe, expect, it, vi } from 'vitest';
import { runCommonRunnerTasks } from '../common-runner-executor.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const task = () => ({ id: uuid(1), status: 'queued', kind: 'agent', payload: {
  common_runner: { run_id: uuid(2), profile: 'demo', mode: 'exploration', input: {} },
}, result: {}, claimed_by: null });
function poolFor(rows) {
  return { query: vi.fn(async (sql, params) => {
    if (sql.startsWith('SELECT')) {
      let selected = rows.filter(t => sql.includes("status='in_progress'") ? t.status === 'in_progress' : t.status === 'queued');
      if (sql.includes('LIMIT 10')) selected = selected.sort((a, b) => {
        const afterA = !params?.[0] || a.id > params[0], afterB = !params?.[0] || b.id > params[0];
        return afterA === afterB ? a.id.localeCompare(b.id) : afterA ? -1 : 1;
      }).slice(0, 10);
      return { rows: selected, rowCount: selected.length };
    }
    if (sql.includes('SET claimed_by')) {
      const t = rows.find(t => t.id === params[0]);
      if (!t || (t.claimed_by && t.claimed_by !== 'common-runner')) return { rows: [], rowCount: 0 };
      t.claimed_by = 'common-runner'; return { rows: [structuredClone(t)], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }) };
}
describe('Brain common runner automatic completion job', () => {
  it('claims at most one AI task and sends its fixed profile through the HTTP dispatch service', async () => {
    const rows = [task(), { ...task(), id: uuid(3) }], pool = poolFor(rows);
    const dispatch = vi.fn(async () => ({ authenticated: true, receipt: { status: 'running' }, central_run: { status: 'running' } }));
    const result = await runCommonRunnerTasks(pool, { dispatcher: { dispatch } });
    expect(result.dispatched).toBe(1); expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('start', uuid(2), { task_id: uuid(1), profile: 'demo', mode: 'exploration', input: {} });
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("kind='agent'") && sql.includes('headed_manual'))).toBe(true);
  });
  it('never starts an existing unknown run again; inspects and flushes evidence before task finalization', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner';
    t.result.common_runner = { run_id: uuid(2), task_id: t.id };
    const pool = poolFor([t]);
    const dispatch = vi.fn(async action => action === 'inspect'
      ? { authenticated: true, receipt: { status: 'completed', writeback: { pending: 1 } }, central_run: { status: 'running' } }
      : { authenticated: true, receipt: { status: 'completed' }, central_run: { status: 'success', recording_status: 'confirmed' } });
    const finalize = vi.fn(async () => ({ rowCount: 1 }));
    const result = await runCommonRunnerTasks(pool, { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(dispatch.mock.calls.map(c => c[0])).toEqual(['inspect', 'flush']);
    expect(finalize).toHaveBeenCalledWith(pool, t.id, 'completed', expect.objectContaining({ onlyIfStatus: 'in_progress', mergeResult: expect.objectContaining({ actor: 'common-runner', evidence: expect.any(Array) }) }));
    expect(result.reaped).toBe(1);
  });
  it('keeps execution ownership when no signed terminal or central evidence confirmation exists', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner'; t.result.common_runner = { run_id: uuid(2), task_id: t.id };
    const dispatch = vi.fn(async () => ({ status: 'unknown', next_action: 'inspect' })), finalize = vi.fn();
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(dispatch.mock.calls.map(c => c[0])).toEqual(['inspect']); expect(finalize).not.toHaveBeenCalled();
  });
  it('does not dispatch a human-owned or headed opt-in task even if returned by a stale scan', async () => {
    const t = task(); t.payload.headed_manual = true;
    const dispatch = vi.fn();
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch } });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('round-robin reaping reaches the eleventh run despite ten earlier offline runs', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ ...task(), id: uuid(i + 1), status: 'in_progress', claimed_by: 'common-runner',
      result: { common_runner: { run_id: uuid(i + 101), task_id: uuid(i + 1) } } }));
    const pool = poolFor(rows), finalize = vi.fn(async () => ({ rowCount: 1 }));
    const dispatch = vi.fn(async (_action, runId) => runId === uuid(111)
      ? { authenticated: true, receipt: { status: 'completed' }, central_run: { status: 'success', recording_status: 'confirmed' } }
      : { status: 'unknown', next_action: 'inspect' });
    await runCommonRunnerTasks(pool, { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(finalize).not.toHaveBeenCalled();
    await runCommonRunnerTasks(pool, { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(finalize).toHaveBeenCalledWith(pool, uuid(11), 'completed', expect.anything());
    expect(dispatch).toHaveBeenCalledTimes(20);
  });
  it('signed not-started wait resumes with its frozen profile/input and the same run', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner';
    t.result.common_runner = { run_id: uuid(2), task_id: t.id, launch_state: 'not_started', profile: 'demo', mode: 'exploration', input: { fixed: true } };
    const dispatch = vi.fn(async () => ({ authenticated: true, receipt: { status: 'running' }, central_run: { status: 'running' } }));
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch } });
    expect(dispatch).toHaveBeenCalledWith('start', uuid(2), { task_id: t.id, profile: 'demo', mode: 'exploration', input: { fixed: true } });
  });
  it('a cancelled not-started wait is only cancelled or inspected, never restarted', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner';
    t.result.common_runner = { run_id: uuid(2), task_id: t.id, launch_state: 'not_started', cancel_requested: true, profile: 'demo', mode: 'exploration', input: {} };
    const dispatch = vi.fn(async () => ({ status: 'unknown', next_action: 'inspect' }));
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch } });
    expect(dispatch).toHaveBeenCalledWith('cancel', uuid(2), { task_id: t.id });
  });
});

describe('公共Runner待审查任务归位',()=>{
  function fixture({confirmed=true,owner='common-runner'}={}){
    const t=task();t.title='质量检查待审查';t.status='in_progress';t.claimed_by=owner;t.result={existing:'preserve',common_runner:{run_id:uuid(2),task_id:t.id,profile:'demo'}};
    const pool=poolFor([t]),base=pool.query;const pending=[];
    pool.query=vi.fn(async(sql,p)=>{
      if(sql.includes("SET status='blocked'")){
        if(t.status!=='in_progress'||t.claimed_by!=='common-runner'||p[0]!==t.id||p[1]!==t.result.common_runner.run_id)return {rows:[],rowCount:0};
        t.status='blocked';t.blocked_reason='owner_decision';t.blocked_detail=JSON.parse(p[2]);t.result.common_runner.business_status='needs_review';return {rows:[structuredClone(t)],rowCount:1};
      }
      if(sql.includes('FROM pending_actions'))return {rows:[],rowCount:0};
      if(sql.includes('INSERT INTO pending_actions')){pending.push({sql,params:p});return {rows:[{id:uuid(10)}],rowCount:1};}
      return base(sql,p);
    });
    const receipt={status:'needs_review',profile_sha256:'a'.repeat(64),validation:{cleanup:{verdict:'pass',acceptance_ref:'cleanup@1',evidence:['released']}},writeback:{pending:0,blocked:0,total:1,acked:1,manifest_sha256:'b'.repeat(64)}};
    const dispatch=vi.fn(async()=>({authenticated:true,receipt,central_run:{status:'needs_review',recording_status:confirmed?'confirmed':'pending'}}));
    return {t,pool,pending,dispatch};
  }
  it('已确认needs_review以task+run+owner的CAS暂停并生成不可自动执行的主理人待办',async()=>{
    const f=fixture(),recordEvent=vi.fn(),finalize=vi.fn();const before=Date.now();const r=await runCommonRunnerTasks(f.pool,{dispatcher:{dispatch:f.dispatch},recordEvent,finalizeTask:finalize});
    expect(f.t.status).toBe('blocked');expect(f.t.blocked_reason).toBe('owner_decision');expect(f.t.blocked_detail).toMatchObject({waiting_on:'human',reversible:false,default:'A',options:expect.any(Array)});
    expect(f.t.blocked_detail.options.length).toBeGreaterThanOrEqual(2);expect(Date.parse(f.t.blocked_detail.deadline)).toBeGreaterThan(before);expect(Date.parse(f.t.blocked_detail.deadline)).toBeLessThan(before+25*3600000);
    expect(f.t.result.existing).toBe('preserve');expect(f.t.result.common_runner).toMatchObject({run_id:uuid(2),task_id:f.t.id,business_status:'needs_review'});
    const mutation=f.pool.query.mock.calls.find(([sql])=>sql.includes("SET status='blocked'"));expect(mutation[0]).toContain("claimed_by='common-runner'");expect(mutation[0]).toContain("result->'common_runner'->>'run_id'=$2");expect(mutation[1].slice(0,2)).toEqual([f.t.id,uuid(2)]);
    expect(f.pending).toHaveLength(1);expect(JSON.parse(f.pending[0].params[0])).toMatchObject({task_id:f.t.id,default:'A',reversible:false});expect(recordEvent).toHaveBeenCalledWith(f.pool,f.t.id,'common_runner_needs_review',expect.objectContaining({run_id:uuid(2)}));expect(finalize).not.toHaveBeenCalled();expect(r.needs_review).toBe(1);
    await runCommonRunnerTasks(f.pool,{dispatcher:{dispatch:f.dispatch},recordEvent,finalizeTask:finalize});expect(f.pending).toHaveLength(1);
  });
  it('固定无资源运行签出明确免清场和执行停止后也能进入owner review',async()=>{
    const f=fixture();const dispatch=async()=>({authenticated:true,receipt:{status:'needs_review',cleanup_required:false,execution_unknown:false,validation:{cleanup:{verdict:'unknown'}},writeback:{pending:0}},central_run:{status:'needs_review',recording_status:'confirmed'}});
    const result=await runCommonRunnerTasks(f.pool,{dispatcher:{dispatch},recordEvent:vi.fn()});expect(result.needs_review).toBe(1);expect(f.t.status).toBe('blocked');expect(f.pending).toHaveLength(1);
  });
  it('生成的不可逆审查协议到期只顺延，不放回队列或执行默认动作',async()=>{
    const f=fixture();await runCommonRunnerTasks(f.pool,{dispatcher:{dispatch:f.dispatch},recordEvent:vi.fn()});
    expect(f.t.status).toBe('blocked');const sql=[];let nextDue;
    const client={release:vi.fn(),query:vi.fn(async(text,p)=>{sql.push(text);if(text.includes('FOR UPDATE'))return {rows:[{...f.t,payload:{}}]};if(text.includes('SET blocked_until'))nextDue=p[1];return {rows:[],rowCount:1};})};
    const deadlinePool={query:vi.fn(async()=>({rows:[f.t]})),connect:async()=>client};
    const {runOwnerDecisionDeadline}=await import('../owner-decision-deadline.js');const expired=Date.parse(f.t.blocked_detail.deadline)+1;
    const result=await runOwnerDecisionDeadline(deadlinePool,{force:true,now:expired,bark:async()=>false});
    expect(result).toMatchObject({applied:0,deferred:1});expect(Date.parse(nextDue)).toBe(expired+24*3600000);expect(f.t.status).toBe('blocked');expect(sql.some(q=>/status\s*=\s*'queued'/.test(q))).toBe(false);
  });
  it('创建主理人待办失败时同事务回滚block，保留执行身份供下轮补记录',async()=>{
    const f=fixture();const initial=structuredClone(f.t),raw=f.pool.query,commands=[];
    const client={release:vi.fn(),query:async(sql,p)=>{commands.push(sql);if(sql==='BEGIN'||sql==='COMMIT')return {rows:[],rowCount:0};if(sql==='ROLLBACK'){Object.assign(f.t,structuredClone(initial));return {rows:[],rowCount:0};}if(sql.includes('INSERT INTO pending_actions'))throw Error('pending storage unavailable');return raw(sql,p);}};
    f.pool.connect=async()=>client;const recordEvent=vi.fn();const result=await runCommonRunnerTasks(f.pool,{dispatcher:{dispatch:f.dispatch},recordEvent});
    expect(result.errors).toBe(1);expect(f.t.status).toBe('in_progress');expect(f.t.result.common_runner.run_id).toBe(uuid(2));expect(commands).toContain('ROLLBACK');expect(commands).not.toContain('COMMIT');expect(recordEvent).not.toHaveBeenCalled();
  });
  it.each([false,true])('记录未确认或owner已变更不暂停任务 %s',async ownerChanged=>{
    const f=fixture({confirmed:ownerChanged,owner:ownerChanged?'headed-session':'common-runner'});const recordEvent=vi.fn();await runCommonRunnerTasks(f.pool,{dispatcher:{dispatch:f.dispatch},recordEvent});expect(f.t.status).toBe('in_progress');expect(f.pending).toHaveLength(0);expect(recordEvent).not.toHaveBeenCalled();
  });
});

it('自动派发显式启用DBOS时复用原run进入持久协调器，不裸启动',async()=>{
 const t=task(),pool=poolFor([t]),dispatch=vi.fn(),durableStart=vi.fn(async()=>({workflow_id:'fixed',handle:{getStatus:async()=>({status:'PENDING'})}}));
 await runCommonRunnerTasks(pool,{dispatcher:{dispatch},env:{DBOS_DURABLE_ENABLED:'true'},durableStart});
 expect(dispatch).not.toHaveBeenCalled();expect(durableStart).toHaveBeenCalledOnce();
 expect(durableStart.mock.calls[0][0]).toMatchObject({run_id:uuid(2),body:{task_id:t.id}});
});
it('自动派发DBOS在绑定前截止时写失败证据，不永久queued等待',async()=>{
 const t=task(),finalizeTask=vi.fn(async()=>({rowCount:1}));
 const durableStart=async()=>({handle:{getStatus:async()=>({status:'SUCCESS'}),getResult:async()=>({status:'needs_review',reason:'common_runner_durable_deadline_exceeded',observation:null})}});
 const result=await runCommonRunnerTasks(poolFor([t]),{env:{DBOS_DURABLE_ENABLED:'true'},dispatcher:{dispatch:vi.fn()},durableStart,finalizeTask,recordEvent:vi.fn()});
 expect(finalizeTask).toHaveBeenCalledOnce();expect(result.failed_preflight).toBe(1);
});
