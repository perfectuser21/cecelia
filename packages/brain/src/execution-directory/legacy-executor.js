import { directory,endpointValid } from './directory.js';
import { authorize } from './store.js';
export function legacyExecutorEntries(){
 return (directory.current()?.nodes??[]).flatMap(n=>n.grants.filter(g=>g.surface==='legacy_executor'&&directory.matches({machineId:n.canonical_id,surface:g.surface,provider:g.provider}))
  .map(g=>({machineId:n.canonical_id,...n.endpoints?.legacy_executor?.[g.provider]})).filter(e=>e.executor&&endpointValid(e.url)));
}
export async function withLegacyExecution({pool,machineId,provider,endpoint,account,repo},operation){
 const entries=legacyExecutorEntries();
 const entry=entries.find(e=>e.executor===provider&&(machineId?e.machineId===machineId:e.url===endpoint));
 if(!entry||(endpoint&&entry.url!==endpoint))throw Error(`execution_legacy_grant_denied:${machineId??endpoint??'unknown'}:${provider}`);
 return authorize(pool,{snapshotVersion:directory.current()?.version,machineId:entry.machineId,surface:'legacy_executor',provider,account,repo},()=>operation());
}
