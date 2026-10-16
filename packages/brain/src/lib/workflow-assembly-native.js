import {randomUUID} from 'node:crypto';
import {runWorkflowAssemblyReconcile} from './workflow-assembly-reconcile-runner.js';
import {nativeSpec as spec,prepareNativeSource,deployedNativeRevision} from './workflow-assembly-native-source.js';
import {registerNativeReconcile} from './workflow-assembly-native-registration.js';
import {claimNativeRound,finishNativeRound} from './workflow-assembly-native-ledger.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
export function nativeReconcileOutcome(report){
  if(report.skipped)return {outcome:'skipped',reason:report.skipped};
  if(report.stopped)return {outcome:report.stopped==='budget'?'timeout':'unknown',reason:report.stopped};
  if(report.errors>0)return {outcome:'fail',reason:'partial_error'};
  return {outcome:'pass',reason:report.checked===0?'empty':'checked'};
}
export function validateNativeReconcileRequest(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='request_key')
    ||typeof input.request_key!=='string'||!/^[A-Za-z0-9:_.-]{1,160}$/.test(input.request_key))throw Object.assign(Error('native_global_request_invalid'),{status:422});
  return {request_key:input.request_key};
}
/** 内部管理员与定时器共用：全局scope，固定预算，不接受tenant/runner注入。 */
export async function runNativeReconcile(pool,{request_key=randomUUID(),trigger='schedule'}={},services={}){
  validateNativeReconcileRequest({request_key});
  if(!['manual','schedule'].includes(trigger))throw Error('native_trigger_invalid');
  const deadline=Date.now()+20000;
  const query=(text,values)=>pool.query({text,values,query_timeout:3000});
  const runId='native:assembly:'+definitionDigest({scope:'global_admin',request_key});
  let current=(await query('SELECT w.current_definition_version_id,v.source_commit FROM workflows w JOIN workflow_definition_versions v ON v.id=w.current_definition_version_id AND v.workflow_id=w.id WHERE w.id=$1',[spec.id])).rows[0];
  let source;
  if(current){try{source=await prepareNativeSource({revision:current.source_commit,readFile:services.readSource,deadline,signal:services.signal});}catch(error){if(services.signal?.aborted||Date.now()>=deadline)throw error;}}
  // 首次和已部署实现升级共用同一owned CAS；不等待逐条人工补登记。
  if(!source){
    source=await prepareNativeSource({revision:services.revision??deployedNativeRevision(),readFile:services.readSource,deadline,signal:services.signal});
    const registered=await registerNativeReconcile(pool,source,{deadline,signal:services.signal});
    current={current_definition_version_id:registered.workflow_definition_version_id,source_commit:source.commit};
  }
  const previous=(await query('SELECT * FROM runs WHERE run_id=$1',[runId])).rows[0];
  if(previous){
    if(previous.workflow_id!==spec.id||previous.detail?.protocol!==spec.protocol||previous.detail?.request_key!==request_key
      ||previous.detail?.scope!=='global_admin'||previous.detail?.input_sha256!==definitionDigest({budget_ms:20000,limit:5})
      ||previous.detail?.workflow_definition_version_id!==current?.current_definition_version_id)throw Object.assign(Error('native_run_identity_conflict'),{status:409});
    return {native_run_id:runId,replayed:true,run:previous};
  }
  let claim,settled,settleError;
  if(services.signal?.aborted||Date.now()>=deadline)return {native_run_id:null,report:{stopped:services.signal?.aborted?'cancelled':'budget'},run:null};
  const report=await runWorkflowAssemblyReconcile(pool,{...(services.runnerOptions??{}),budgetMs:deadline-Date.now(),limit:5,signal:services.signal,
    onLocked:async(db,{check})=>{
      const guarded={query:async(...args)=>{check();const result=await db.query(...args);check();return result;}};
      claim=await claimNativeRound(guarded,{runId,requestKey:request_key,trigger,source});return claim.created;
    },
    onSettled:async(db,result,error)=>{
      if(!claim?.created)return;
      try{settled=await finishNativeRound(db,claim,result,error&&!result.stopped?{outcome:'fail',reason:'native_error'}:nativeReconcileOutcome(result),error&&!result.stopped?error:null);}
      catch(e){settleError=e;}
    },
  });
  if(settleError)throw settleError;
  if(claim?.created&&!settled)throw Object.assign(Error('native_run_terminal_unrecorded'),{status:503});
  return {native_run_id:claim?runId:null,report,run:settled??claim?.row??null,replayed:claim?.created===false};
}
