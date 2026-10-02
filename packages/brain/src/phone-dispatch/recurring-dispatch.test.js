import {EventEmitter} from 'node:events';
import {it,expect} from 'vitest';
import {withRecurringTemplateGate} from './recurring-dispatch.js';
function fixture(){
 const trace=[];class Client extends EventEmitter{
  async connect(){trace.push('connect');expect(this.listenerCount('error')).toBe(1);}
  async query(sql){trace.push(sql);const text=sql.text||sql;if(text.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(text.includes('AS registered'))return {rows:[{registered:false}]};if(text.includes('pg_advisory_unlock'))return {rows:[{unlocked:true}]};return {rows:[]};}
  async end(){trace.push('end');}
  connection={stream:{destroy:()=>trace.push('destroy')}};
 }
 const c=new Client();return {c,trace,options:{clientFactory:()=>c}};
}
it('recurring-dispatch同session adapter保ownTX借用且全部业务settled后解锁',async()=>{const f=fixture();await withRecurringTemplateGate({},'template',async(client,ordinary)=>{expect(client).toBe(f.c);expect(ordinary.constructor.name).not.toBe('Client');const borrowed=await ordinary.connect();await borrowed.query('BEGIN');await borrowed.query('COMMIT');borrowed.release();expect(f.trace).not.toContain('end');},f.options);expect(f.trace.indexOf('COMMIT')).toBeLessThan(f.trace.findIndex(s=>String(s.text||s).includes('pg_advisory_unlock')));expect(f.trace.at(-1)).toBe('end');});
it('recurring-dispatch idleerror为永久fatal，禁止后续query且销毁自己session不提前unlock',async()=>{const f=fixture();await expect(withRecurringTemplateGate({},'template',async client=>{client.emit('error',Error('idle EOF'));await client.query('BUSINESS');},f.options)).rejects.toThrow('idle EOF');expect(f.trace).not.toContain('BUSINESS');expect(f.trace.some(s=>String(s.text||s).includes('pg_advisory_unlock'))).toBe(false);expect(f.trace).toContain('destroy');});
it('recurring-dispatch querytimeout在途不发ROLLBACK/unlock，不复用session',async()=>{const f=fixture();const query=f.c.query.bind(f.c);f.c.query=async sql=>{if(sql==='BUSINESS'){f.trace.push(sql);throw Error('Query read timeout');}return query(sql);};await expect(withRecurringTemplateGate({},'template',client=>client.query('BUSINESS'),f.options)).rejects.toThrow('timeout');expect(f.trace).not.toContain('ROLLBACK');expect(f.trace.some(s=>String(s.text||s).includes('pg_advisory_unlock'))).toBe(false);expect(f.trace).toContain('destroy');});
it('recurring-dispatch固定1秒只限连接/取锁，原业务查询预算保持',async()=>{const f=fixture();let config;await withRecurringTemplateGate({options:{connectionTimeoutMillis:600000,query_timeout:600000}},'template',async client=>{await client.query('BUSINESS');},{clientFactory:c=>{config=c;return f.c;}});expect(config.connectionTimeoutMillis).toBe(1000);const acquire=f.trace.find(s=>typeof s==='object'&&s.text?.includes('pg_try_advisory_lock'));expect(acquire?.query_timeout).toBe(1000);expect(config.query_timeout).toBe(600000);});
it('recurring-dispatch fatal本地close不能授权flush既有effects',async()=>{const f=fixture();let captured=false;const error=await withRecurringTemplateGate({},'template',async c=>{captured=true;c.emit('error',Error('idle EOF'));},f.options).catch(e=>e);expect(captured).toBe(true);expect(error.gateSessionClosed).toBe(false);});
