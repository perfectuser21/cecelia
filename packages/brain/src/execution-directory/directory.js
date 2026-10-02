import { phoneSshValid } from '../phone-dispatch/identity.js';
import { bindExecutionProfileReader } from '../orchestrator/fleet-node/node-profile.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
export const DIRECTORY_QUERY = `SELECT n.canonical_id,n.machine_registry_id,v.*,r.name,r.metadata,r.status AS machine_status,
 COALESCE((SELECT jsonb_agg(g ORDER BY g.id) FROM execution_grants g WHERE g.node_version_id=v.id),'[]') AS grants
 FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id
 JOIN system_registry r ON r.id=n.machine_registry_id ORDER BY n.canonical_id`;
export const hashConfig = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze = value => { if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };
export function endpointValid(value) {
 try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/';} catch{return false;}
}
export function createExecutionDirectory({now=Date.now,ttlMs=30_000}={}) {
 const context=new AsyncLocalStorage();let published=null;let refreshTail=Promise.resolve();
 function current(){const scoped=context.getStore();const s=scoped===undefined?published:scoped;return s&&s.expiresAt>now()?s:null;}
 function targets(){return (current()?.nodes??[]).flatMap(n=>n.grants.filter(g=>eligible(n,g)&&g.surface==='harness').map(g=>({provider:g.provider,account:g.account_id,machine:n.canonical_id}))).sort((a,b)=>['codex','claude','grok'].indexOf(a.provider)-['codex','claude','grok'].indexOf(b.provider)||a.account.localeCompare(b.account)||a.machine.localeCompare(b.machine));}
 function eligible(n,g){return n.state==='active'&&n.machine_status==='active'&&(g.surface==='phone_ssh'?phoneSshValid(n.endpoints?.phone_ssh):endpointValid(n.endpoints?.worker))&&g.state==='active'&&(!g.expires_at||Date.parse(g.expires_at)>now());}
 function matches({machineId,surface,provider,account='',repo,profileId=''}){
  if(['harness','app_server'].includes(surface)&&!repo)return null;
  const n=current()?.nodes.find(n=>n.canonical_id===machineId);
  const g=n?.grants.find(g=>eligible(n,g)&&g.surface===surface&&g.provider===provider&&g.account_id===account&&g.profile_id===profileId&&(!repo||g.repo_scope.includes(repo)));
  return g?{node:n,grant:g}:null;
 }
 return Object.freeze({current,targets,matches,withSnapshot:(s,fn)=>context.run(s,fn),
  async refresh({pool}) {
   const operation=refreshTail.then(async()=>{
    const {rows}=await pool.query(DIRECTORY_QUERY);const nodes=structuredClone(rows);
    const version=hashConfig(nodes);published=freeze({version,nodes,expiresAt:now()+ttlMs});return published;
   });
   refreshTail=operation.catch(()=>{});return operation;

  },
 });
}
export const directory=createExecutionDirectory();
export const current=()=>directory.current();
export const refresh=(options)=>directory.refresh(options);
export const withSnapshot=(snapshot,fn)=>directory.withSnapshot(snapshot,fn);
export const currentNode=machineId=>current()?.nodes.find(n=>n.canonical_id===machineId)??null;
export const currentWorkerUrls=()=>Object.fromEntries((current()?.nodes??[]).filter(n=>n.state==='active'&&n.machine_status==='active'&&endpointValid(n.endpoints?.worker)).map(n=>[n.canonical_id,n.endpoints.worker]));

bindExecutionProfileReader(()=>current()?.nodes??[]);
