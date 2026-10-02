import pg from 'pg';
import {DB_DEFAULTS} from '../db-config.js';
/** One actual session owns the gate and every business query. Never borrow the main pool. */
export async function withRecurringTemplateGate(db,templateId,operation,{clientFactory=config=>new pg.Client(config)}={}){
 const client=clientFactory(db.options||DB_DEFAULTS);let fatal=null,locked=false,error,value;
 client.on('error',e=>{fatal ||= e;}); // installed before connect, including idle socket errors
 const query=client.query.bind(client);
 client.query=async(...args)=>{
  if(fatal)throw fatal;
  try{return await query(...args);}catch(e){if(/timeout|connection terminated|ECONNRESET|EOF/i.test(e.message))fatal ||= e;throw e;}
 };
 const key=`phone-schedule:${templateId}`;
 const ordinary={query:(...a)=>client.query(...a),connect:async()=>({query:(...a)=>client.query(...a),release(){}})};
 try{
  await client.connect();
  locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked;
  if(!locked)value={state:'busy'};
  else{
   const registered=(await client.query('SELECT EXISTS(SELECT 1 FROM phone_schedule_registrations WHERE template_id=$1) AS registered',[templateId])).rows[0].registered;
   value=await operation(client,ordinary,registered);
   if(fatal)throw fatal;
  }
 }catch(e){error=e;}
 // A timed-out query can still be running in PostgreSQL. Close its sole session, never unlock early.
 try{
  if(locked&&!fatal){
   await client.query('ROLLBACK');
   if(!(await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked',[key])).rows[0].unlocked)throw Error('phone_schedule_gate_release_unknown');
  }
 }catch(e){error ||= e;fatal ||= e;}
 if(fatal)client.connection?.stream?.destroy();
 try{await client.end();}catch(e){throw Object.assign(Error('phone_schedule_gate_release_unknown'),{cause:error||e,gateSessionClosed:false});}
 if(error)throw Object.assign(error,{gateSessionClosed:true});
 return value;
}
