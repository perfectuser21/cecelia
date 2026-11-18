import { describe, expect, it, vi } from 'vitest';
import { registerExistingOpsSources, validateExistingOpsRegistry } from '../existing-ops-registration.js';
import * as collector from '../existing-ops-source.js';
import { stepSha256 } from '../../../scripts/sync-steps-from-workspace.mjs';
import { EXISTING_OPS_IDENTITIES } from '../existing-ops-source.js';

const root = 'aaaaaaaa-f0f0-4000-8000-000000000001';
const options = () => ({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia',
  revision: 'a'.repeat(40), expectedRegistrySha256: 'b'.repeat(64), actor: 'registration-boundary-test',
  checkMain: async () => {}, readSource: async () => { throw Error('UNEXPECTED_SOURCE_READ'); } });

describe('existing factory registration admission before source or database access', () => {
  it('rejects missing trust/CAS, foreign scope/repo and invalid mode before any database access', async () => {
    let databaseCalls = 0;
    const forbiddenDatabase = { query() { databaseCalls++; throw Error('UNEXPECTED_DATABASE_ACCESS'); },
      connect() { databaseCalls++; throw Error('UNEXPECTED_DATABASE_ACCESS'); } };
    for (const change of [{ checkMain: undefined }, { expectedRegistrySha256: undefined },
      { scope: 'cecelia-kr' }, { repo: 'foreign/repo' }, { mode: 'feature_main' }, { actor: ' ' }]) {
      await expect(registerExistingOpsSources(forbiddenDatabase, { ...options(), ...change }))
        .rejects.toMatchObject({ code: 'OPS_REGISTRATION_INPUT_INVALID' });
    }
    expect(databaseCalls).toBe(0);
  });

  it('rejects a moved main before reading source or opening an append transaction', async () => {
    let reads = 0, connections = 0;
    await expect(registerExistingOpsSources({ connect() { connections++; } }, { ...options(),
      checkMain: async () => { throw Error('MAIN_MOVED'); }, readSource: async () => { reads++; return ''; } }))
      .rejects.toThrow('MAIN_MOVED');
    expect({ reads, connections }).toEqual({ reads: 0, connections: 0 });
  });

  it('preserves the two real owners and refuses a human-edited slot or foreign business parent', () => {
    const registry = { value_streams: [{ id: root }],
      workflows: EXISTING_OPS_IDENTITIES.map(i => ({ id: i.workflow_id, key: i.workflow_key, capability_id: i.capability_id })),
      capabilities: EXISTING_OPS_IDENTITIES.map(i => ({ id: i.capability_id, parent_journey_id: root })),
      references: EXISTING_OPS_IDENTITIES.flatMap(i => [i.reference_id, ...i.unverified_reference_ids].map((id, n) => ({
        id, workflow_id: i.workflow_id, activity_id: n === 0 ? i.activity_id : id,
        slot_key: `step_${n + 1}`, sequence_no: n + 1, active: true }))) };
    const original = structuredClone(registry);
    expect(() => validateExistingOpsRegistry(registry)).not.toThrow();
    expect(registry).toEqual(original);
    for (const edit of [r => { r.references[0].slot_key = 'human_slot'; },
      r => { r.capabilities[0].parent_journey_id = 'foreign'; }]) {
      const changed = structuredClone(original); edit(changed);
      expect(() => validateExistingOpsRegistry(changed)).toThrow('OPS_REGISTRY_IDENTITY_INVALID');
    }
  });
});

it('F2退役不阻F3追加来源历史，且从不写F2定义',async()=>{
 const [f2,f3]=EXISTING_OPS_IDENTITIES;
 const registry={workflows:EXISTING_OPS_IDENTITIES.map(i=>({id:i.workflow_id,key:i.workflow_key,capability_id:i.capability_id})),
 references:EXISTING_OPS_IDENTITIES.flatMap(i=>[i.reference_id,...i.unverified_reference_ids].map((id,n)=>({id,workflow_id:i.workflow_id,activity_id:n? id:i.activity_id,slot_key:`step_${n+1}`,sequence_no:n+1,active:true}))),
 activities:[],steps:[],capabilities:EXISTING_OPS_IDENTITIES.map(i=>({id:i.capability_id,parent_journey_id:root})),value_streams:[{id:root}]};
 const rows=[];
 const db={release(){},async query(sql,args){
  if(sql.startsWith('INSERT INTO ')){rows.push({id:`definition-${rows.length}`,payload:args[1],owner:args[0]});return {rows:[]};}
  if(sql.startsWith('SELECT * FROM activity_definition_versions')||sql.startsWith('SELECT * FROM workflow_definition_versions'))return {rows:[rows.find(r=>r.owner===args[0])]};
  for(const [table,key]of [['workflow_activity_refs','references'],['workflows','workflows'],['activities','activities'],['steps','steps'],['capabilities','capabilities'],['value_streams','value_streams']])if(sql.startsWith(`SELECT * FROM ${table} `))return {rows:registry[key]};
  return {rows:[]};
 }};
 const spy=vi.spyOn(collector,'buildExistingOpsSources').mockResolvedValue({consumers:[{...f2,status:'unknown',gaps:[{code:'consumer_retired'}],bindings:[],input_relations:[]},{...f3,status:'verified',gaps:[],bindings:[{path:'f3-source'}],input_relations:[]}],workflows:[{workflow_id:f3.workflow_id,coverage:{}}]});
 try{
  const result=await registerExistingOpsSources({connect:async()=>db},{...options(),expectedRegistrySha256:stepSha256(registry)});
  expect(result.definitions.workflows.map(w=>w.owner)).toEqual([f3.workflow_id]);
  expect(rows.map(r=>r.owner)).toEqual([f3.activity_id,f3.workflow_id]);
  expect(result.executable).toBe(false);
 }finally{spy.mockRestore();}
});

it('F3缺失、重复、unknown或有缺口都不能因F2退役获准登记',async()=>{
 const f3={...EXISTING_OPS_IDENTITIES[1],status:'verified',gaps:[],bindings:[{path:'f3-source'}],input_relations:[]};
 for(const consumers of [[],[f3,f3],[{...f3,status:'unknown'}],[{...f3,gaps:[{code:'source_unavailable'}]}]]){
  const spy=vi.spyOn(collector,'buildExistingOpsSources').mockResolvedValue({consumers});
  try{await expect(registerExistingOpsSources({connect(){throw Error('UNEXPECTED_APPEND');}},options())).rejects.toMatchObject({code:'OPS_SOURCE_UNKNOWN'});}finally{spy.mockRestore();}
 }
});
