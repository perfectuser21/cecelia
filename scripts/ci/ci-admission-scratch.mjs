/** 仅CI内部租约：复用完整scratch表结构，独占ci_admission命名空间。 */
import {createImplementationScratch} from './implementation-scratch.mjs';
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export async function createCiAdmissionScratch({openBase=createImplementationScratch}={}){
 const base=await openBase();let renamed=false,closed=false,name;
 const close=async()=>{
  if(closed)return;closed=true;
  try{if(renamed){await base.db.query('ROLLBACK');await base.db.query('SET search_path TO public');await base.db.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);}}
  finally{await base.close();}
 };
 try{
  need(/^implementation_ci_[a-f0-9]{32}$/.test(base.schema||''),'CI_ADMISSION_SCRATCH_LEASE_REQUIRED');
  name=base.schema.replace(/^implementation_ci_/,'ci_admission_');
  await base.db.query(`ALTER SCHEMA ${base.schema} RENAME TO ${name}`);renamed=true;
  await base.db.query(`SET search_path TO ${name}`);
  const identity=(await base.db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
  need(identity?.database==='cecelia_scratch'&&identity.schema===name,'CI_ADMISSION_SCRATCH_IDENTITY');
  return {db:base.db,schema:name,close};
 }catch(error){try{await close();}catch(cleanup){error.cleanup=cleanup;}throw error;}
}
