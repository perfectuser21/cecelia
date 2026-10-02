'use strict';
function valid(value){return value&&['pending','in_flight','activity_revision'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0)&&['draining','stable','quiescent'].every(k=>typeof value[k]==='boolean')&&(!value.quiescent||(value.draining&&value.stable&&value.pending===0&&value.in_flight===0));}
function createMaintenance({local,targets,probe}){
 if(typeof local!=='function'||typeof probe!=='function'||!Array.isArray(targets)||targets.length===0)throw Error('phone_maintenance_unconfigured');
 return async()=>{
  const before=await local();if(!valid(before))throw Error('phone_maintenance_unconfirmed');
  const observations=await Promise.all(targets.map(async target=>{
   try{const result=await probe(target.machine_id);if(!valid(result?.maintenance))throw Error('unknown');return {machine_id:target.machine_id,status:'verified',...result.maintenance};}
   catch{return {machine_id:target.machine_id,status:'unknown'};}
  }));
  const after=await local();if(!valid(after))throw Error('phone_maintenance_unconfirmed');
  const known=observations.every(v=>v.status==='verified');
  const stable=known&&observations.every(v=>v.stable)&&before.activity_revision===after.activity_revision&&before.stable&&after.stable&&before.draining&&after.draining;
  return {proof_scope:'hub-control',hub_control:after,targets:observations,pending:known?Math.max(before.pending,after.pending)+observations.reduce((sum,v)=>sum+v.pending,0):null,
   stable,quiescent:stable&&before.quiescent&&after.quiescent&&observations.every(v=>v.status==='verified'&&v.quiescent)};
 };
}
module.exports={createMaintenance};
