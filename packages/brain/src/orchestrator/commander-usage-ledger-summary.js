export const fail=code=>{throw Object.assign(Error(code),{code});};
export const copy=value=>JSON.parse(JSON.stringify(value));
export function canonical(value){
 if(value===null||['string','boolean'].includes(typeof value))return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 fail('usage_ledger_metadata_invalid');
}
export const equal=(a,b)=>canonical(a)===canonical(b);
const tokens=['input_tokens','output_tokens','cached_input_tokens','cache_write_input_tokens','reasoning_output_tokens'];
export function normalizeUsage(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value))fail('usage_ledger_usage_invalid');
 const usage=Object.fromEntries(tokens.map(k=>[k,value[k]??null]));
 for(const n of Object.values(usage))if(n!==null&&(!Number.isSafeInteger(n)||n<0))fail('usage_ledger_usage_invalid');
 for(const [child,parent] of [['cached_input_tokens','input_tokens'],['cache_write_input_tokens','input_tokens'],['reasoning_output_tokens','output_tokens']])if(usage[child]!==null&&usage[parent]!==null&&usage[child]>usage[parent])fail('usage_ledger_usage_invalid');
 if(usage.input_tokens!==null&&usage.cached_input_tokens!==null&&usage.cache_write_input_tokens!==null&&usage.cached_input_tokens+usage.cache_write_input_tokens>usage.input_tokens)fail('usage_ledger_usage_invalid');
 usage.total_tokens=usage.input_tokens===null||usage.output_tokens===null?null:usage.input_tokens+usage.output_tokens;
 if(usage.total_tokens!==null&&!Number.isSafeInteger(usage.total_tokens))fail('usage_ledger_usage_invalid');
 return usage;
}
export function normalizeTurns(events){
 if(!Array.isArray(events))fail('usage_ledger_usage_invalid');
 const turns=events.filter(e=>e?.type==='turn.completed');if(!turns.length)return null;
 const rows=turns.map(e=>normalizeUsage(e.usage?{...e.usage,cached_input_tokens:e.usage.cached_input_tokens??e.usage.input_tokens_details?.cached_tokens,
  reasoning_output_tokens:e.usage.reasoning_output_tokens??e.usage.output_tokens_details?.reasoning_tokens}:null));
 return normalizeUsage(Object.fromEntries(tokens.map(k=>[k,rows.some(u=>u?.[k]==null)?null:rows.reduce((n,u)=>n+u[k],0)])));
}
export function callCost(call,policy){
 if(call.dispatch_status==='not_started')return {kind:'not_applicable',usd:null};
 if(call.auth_mode==='subscription')return {kind:'unknown',usd:null};
 if(call.cost_usd!==undefined)return {kind:'actual',usd:call.cost_usd};
 const rate=policy.pricing,u=call.usage;
 if(!rate||rate.provider!==call.provider||rate.model!==call.model||u?.input_tokens==null||u.output_tokens==null||u.cached_input_tokens==null)return {kind:'unknown',usd:null};
 const usd=((u.input_tokens-u.cached_input_tokens)*rate.input_per_million+u.cached_input_tokens*rate.cached_input_per_million+u.output_tokens*rate.output_per_million)/1e6;
 return {kind:'estimated',usd,pricing_version:rate.version,pricing_source:rate.source};
}
export function summarize(snapshot){
 const calls=snapshot.calls.map(c=>({...c,usage:normalizeUsage(c.usage),cost:callCost(c,snapshot.policy)}));
 const active=calls.filter(c=>c.dispatch_status!=='not_started');
 const pending=calls.filter(c=>c.status==='prepared').map(c=>c.call_id);
 const unknown=active.filter(c=>c.usage?.total_tokens==null).length;
 const known=active.reduce((n,c)=>n+(c.usage?.total_tokens??0),0);
 const unknownCost=active.filter(c=>c.cost.kind==='unknown').length;
 const actual=active.filter(c=>c.cost.kind==='actual').reduce((n,c)=>n+c.cost.usd,0);
 const estimated=active.filter(c=>c.cost.kind==='estimated').reduce((n,c)=>n+c.cost.usd,0);
 const kind=!active.length?'not_applicable':unknownCost?'unknown':actual&&estimated?'mixed':active.some(c=>c.cost.kind==='estimated')?'estimated':'actual';
 return {...snapshot,calls,pending_call_ids:pending,
  coverage:{complete:pending.length===0&&unknown===0,measurement:'cli_turn_usage',call_count:calls.length,known_usage_calls:active.length-unknown,unknown_usage_calls:unknown,pending_calls:pending.length},
  summary:{call_count:calls.length,known_total_tokens:known,total_tokens:unknown?null:known,unknown_usage_calls:unknown,
   input_tokens:active.some(c=>c.usage?.input_tokens==null)?null:active.reduce((n,c)=>n+c.usage.input_tokens,0),
   output_tokens:active.some(c=>c.usage?.output_tokens==null)?null:active.reduce((n,c)=>n+c.usage.output_tokens,0),
   cost:{kind,total_usd:unknownCost?null:actual+estimated,actual_usd:actual,estimated_usd:estimated,unknown_calls:unknownCost}}};
}
export function mergeLedgerSnapshots(persisted,observed){
 if(!persisted)return observed?copy(summarize(observed)):null;
 if(!observed)return copy(summarize(persisted));
 if(!equal(persisted.identity,observed.identity))fail('usage_ledger_identity_conflict');
 if(!equal(persisted.policy,observed.policy))fail('usage_ledger_policy_conflict');
 const merged={schema_version:1,identity:copy(observed.identity),policy:copy(observed.policy),as_of_ms:Math.max(persisted.as_of_ms,observed.as_of_ms)};
 for(const [group,id] of [['calls','call_id'],['attempts','attempt_id'],['observations','observation_id']]){
  const records=new Map();
  for(const r of [...persisted[group],...observed[group]]){
   const previous=records.get(r[id]);
   if(!previous){records.set(r[id],copy(r));continue;}
   if(!equal(previous.prepared,r.prepared))fail('usage_ledger_identity_conflict');
   if(previous.status!=='prepared'&&r.status!=='prepared'&&!equal(previous,r))fail('usage_ledger_terminal_conflict');
   if(previous.status==='prepared'&&r.status!=='prepared')records.set(r[id],copy(r));
  }
  merged[group]=[...records.values()].sort((a,b)=>a.prepared_at_ms-b.prepared_at_ms||a[id].localeCompare(b[id]));
 }
 return summarize(merged);
}
