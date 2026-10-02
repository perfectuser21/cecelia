'use strict';
const MARKER_FIELDS=['boot_id','dev','ino','size','mtime_ns','ctime_ns','uid','gid','mode'];
function markerIdentityValid(value){return value&&Object.keys(value).length===MARKER_FIELDS.length&&MARKER_FIELDS.every(k=>Object.hasOwn(value,k))&&typeof value.boot_id==='string'&&value.boot_id.length>0&&value.boot_id.length<=256&&MARKER_FIELDS.slice(1).every(k=>typeof value[k]==='string'&&/^[0-9]{1,30}$/.test(value[k]));}
function sameMarker(a,b){return markerIdentityValid(a)&&markerIdentityValid(b)&&MARKER_FIELDS.every(k=>a[k]===b[k]);}
function valid(value){return value&&['pending','in_flight','activity_revision'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0)&&['draining','stable','quiescent'].every(k=>typeof value[k]==='boolean')&&
 (markerIdentityValid(value.marker_identity)||(value.marker_identity===null&&!value.draining))&&(!value.quiescent||(value.draining&&value.stable&&value.pending===0&&value.in_flight===0));}
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
  const stable=known&&observations.every(v=>v.stable)&&before.activity_revision===after.activity_revision&&sameMarker(before.marker_identity,after.marker_identity)&&before.stable&&after.stable&&before.draining&&after.draining;
  return {proof_scope:'hub-control',hub_control:after,targets:observations,pending:known?Math.max(before.pending,after.pending)+observations.reduce((sum,v)=>sum+v.pending,0):null,
   stable,quiescent:stable&&before.quiescent&&after.quiescent&&observations.every(v=>v.status==='verified'&&v.quiescent)};
 };
}
module.exports={createMaintenance,valid,markerIdentityValid};
