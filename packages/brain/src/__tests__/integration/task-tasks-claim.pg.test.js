import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { DB_DEFAULTS } from '../../db-config.js';
import { createPhoneClaimFixture } from '../fixtures/phone-claim-schema.js';
const h = vi.hoisted(() => ({ pool: null, trigger: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { get options() { return h.pool.options; }, query: (...a) => h.pool.query(...a), connect: () => h.pool.connect() } }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn(), blockTask: vi.fn() }));
vi.mock('../../executor.js', () => ({ triggerCeceliaRun: h.trigger, checkCeceliaRunAvailable: vi.fn() }));
let f, server, base;
beforeEach(() => vi.clearAllMocks());
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } server = null; if (f) await f.close(); f = null; });
async function setup() {
 f = await createPhoneClaimFixture(pool => h.pool = pool, { publicClaims: true });
 expect(f.location).toEqual({ db: DB_DEFAULTS.database, schema: f.schema });
 const ledger = (await f.pool.query("SELECT version FROM schema_version WHERE version IN ('471','508','509','519') ORDER BY version")).rows;
 expect(ledger).toEqual(['471','508','509','519'].map(version => ({ version })));
 const tasks = (await import('../../routes/task-tasks.js')).default, legacy = (await import('../../routes/tasks.js')).default;
 const app = express(); app.use(express.json());
 // Actual server registration precedence: nested tasks, legacy brain routes, canonical fallback.
 app.use('/api/brain/tasks/tasks', tasks); app.use('/api/brain', legacy); app.use('/api/brain/tasks', tasks);
 server = createServer(app); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); base = `http://127.0.0.1:${server.address().port}`;
}
async function claim(id, body = { claimer: 'fixture-agent' }, alias = 'canonical') {
 const response = await fetch(`${base}/api/brain/tasks/${alias === 'nested' ? 'tasks/' : ''}${id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
 return { status: response.status, body: await response.json() };
}
it.each(['canonical','nested'])('both actual %s alias refuses three actual phone owners with no claim/ledger mutation', async alias => {
 await setup(); const before = await f.snapshot();
 for (const key of ['owner','old','historical']) expect(await claim(f[key], undefined, alias)).toMatchObject({ status: 409, body: { error: 'phone_task_owned' } });
 expect(await f.snapshot()).toEqual(before); expect(h.trigger).not.toHaveBeenCalled();
});
it.each(['canonical','nested'])('caller rawphone on ordinary %s never mints execution identity', async alias => {
 await setup(); const id = await f.ordinary(), before = (await f.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows;
 expect(await claim(id, { claimer: 'fixture-agent', executor_kind: 'phone-ssh-controller' },alias)).toEqual({ status: 400, body: { error: 'phone_executor_not_public' } });
 expect((await f.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows).toEqual(before);
});
it.each(['queued','pending','paused','failed','in_progress'])('ordinary original %s state and fake phone flags claim with default headed-session', async status => {
 await setup(); const id = await f.ordinary({ phone_authority: true, executor_kind: 'phone-ssh-controller' }); await f.pool.query('UPDATE tasks SET status=$2 WHERE id=$1',[id,status]);
 const result = await claim(id); expect(result.status).toBe(200); expect(result.body).toEqual({ id, claimed_by: 'fixture-agent', claimed_at: expect.any(String), executor_kind: 'headed-session' });
 const row = (await f.pool.query('SELECT status,claimed_by,claimed_at,executor_kind FROM tasks WHERE id=$1',[id])).rows[0];
 expect(row).toMatchObject({ status, claimed_by: 'fixture-agent', executor_kind: 'headed-session' }); expect(row.claimed_at.toISOString()).toBe(result.body.claimed_at);
});
it('legitimate bridge claim uses actual471 constraints and509 guards, existing executor never overwritten', async () => {
 await setup(); const id = await f.ordinary(); const bridge = await claim(id,{ claimer:'fixture-bridge',executor_kind:'bridge' }); expect(bridge).toMatchObject({ status:200,body:{ id,claimed_by:'fixture-bridge',executor_kind:'bridge' } });
 const another = (await f.pool.query("INSERT INTO tasks(title,status,task_type,executor_kind) VALUES('existing bridge','queued','dev','bridge') RETURNING id")).rows[0].id;
 expect(await claim(another,{ claimer:'fixture-agent' })).toMatchObject({ status:200,body:{ executor_kind:'bridge' } });
});
it('original missingclaimer400/missing404/alreadyclaimed409 shape is preserved', async () => {
 await setup(); const id = await f.ordinary(); expect(await claim(id,{})).toEqual({status:400,body:{error:'claimer is required'}});
 const absent='00000000-0000-0000-0000-000000000000'; expect(await claim(absent)).toEqual({status:404,body:{error:'Task not found',id:absent}});
 const first=await claim(id); expect(await claim(id,{claimer:'other'})).toEqual({status:409,body:{error:'Task already claimed',claimed_by:first.body.claimed_by,claimed_at:first.body.claimed_at}});
});
it('unknown real owner relation fails closed without ordinary claim', async () => {
 await setup(); const id=await f.ordinary(); await f.pool.query('ALTER TABLE phone_task_owners RENAME TO fixture_unavailable_owner');
 try { expect((await claim(id)).status).toBe(500); expect((await f.pool.query('SELECT claimed_by,executor_kind FROM tasks WHERE id=$1',[id])).rows[0]).toEqual({claimed_by:null,executor_kind:null}); }
 finally { await f.pool.query('ALTER TABLE fixture_unavailable_owner RENAME TO phone_task_owners'); }
});
it('unknown authority boolean never defaults to ordinary', async () => {
 await setup(); const id=await f.ordinary(), query=f.pool.query.bind(f.pool);
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:(sql,args)=>/ordinary_eligible/.test(sql)?Promise.resolve({rows:[{id,ordinary_eligible:null}]}):query(sql,args)};
 expect((await claim(id)).status).toBe(500); expect((await query('SELECT claimed_by FROM tasks WHERE id=$1',[id])).rows[0].claimed_by).toBeNull();
});
it.each(['other-claim','delete'])('real second-session ordinary %s uses actual509 writer contract, without invented deletion race', async point => {
 await setup(); const id=await f.ordinary(), query=f.pool.query.bind(f.pool); let changed=false, mutationRows;
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{
  if (/UPDATE tasks SET claimed_by = \$1/.test(sql)&&!changed) { changed=true; const c=await f.pool.connect(); try { await c.query('BEGIN'); mutationRows=(await c.query(point==='delete'?'DELETE FROM tasks WHERE id=$1':"UPDATE tasks SET claimed_by='fixture-other',claimed_at='2026-01-01T00:00:00Z' WHERE id=$1",[id])).rowCount; await c.query('COMMIT'); } finally { c.release(); } }
  return query(sql,args);
 }};
 const result=await claim(id); expect(changed).toBe(true);
 if(point==='delete') {
  expect(mutationRows).toBe(1); expect(result).toEqual({status:404,body:{error:'Task not found',id}});
  expect((await query('SELECT id FROM tasks WHERE id=$1',[id])).rows).toEqual([]);
 } else {
  expect(mutationRows).toBe(1); expect(result).toEqual({status:409,body:{error:'Task already claimed',claimed_by:'fixture-other',claimed_at:'2026-01-01T00:00:00.000Z'}});
 }
 expect(h.trigger).not.toHaveBeenCalled();
});
it('exact final native CAS excludes all phone IDs (SQL negative, not identity rebinding race)', async () => {
 await setup(); const before=await f.snapshot(),id=await f.ordinary(),query=f.pool.query.bind(f.pool); let mutation;
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{if(/UPDATE tasks SET claimed_by = \$1/.test(sql))mutation=sql;return query(sql,args);}};
 expect((await claim(id)).status).toBe(200); expect(mutation).toBeTruthy();
 for(const phoneId of [f.owner,f.old,f.historical]) expect((await query(mutation,['fixture-agent',phoneId,'headed-session'])).rowCount).toBe(0);
 expect(await f.snapshot()).toEqual(before);
});
it.each(['rowcount-zero','rows-empty'])('native mutation result %s inconsistency never returns false claim success', async fault => {
 await setup(); const id=await f.ordinary(),query=f.pool.query.bind(f.pool);
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{
  const result=await query(sql,args);
  if(/UPDATE tasks SET claimed_by = \$1/.test(sql))return fault==='rowcount-zero'?{...result,rowCount:0}:{...result,rows:[]};
  return result;
 }};
 expect((await claim(id)).status).toBe(500); expect((await query('SELECT claimed_by FROM tasks WHERE id=$1',[id])).rows[0].claimed_by).toBe('fixture-agent');
});
