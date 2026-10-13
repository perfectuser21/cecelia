import {afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {implementationImpactDatabase,IMPACT_REPO} from '../fixtures/implementation-impact-db.js';
import {migrationTable} from '../fixtures/minimum-definition-schema.js';
import {registerWorkflow,registrationDigest} from '../../workflow-authoring/registration.js';
import {prepareDefinitionFreeze} from '../../workflow-authoring/freeze.js';
import {exportImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
let f;
afterEach(async()=>{await f?.close();f=null;});
async function registerInternal(){
  f=await implementationImpactDatabase();const db=f.db,cap=randomUUID(),skill=randomUUID();
  await db.query(migrationTable('283_skill_registry_and_journey_step_links.sql','skill_registry'));
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'内部监控',$2,'active')",[cap,f.ids.valueStream]);
  await db.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'commander','/skills/commander/SKILL.md','active')",[skill]);
  const d={key:'workflow_report.internal',name:'内部报告',capability_id:cap,channel:'internal',form:'code',version:'1.0.0',
    source:{repo:IMPACT_REPO,ref:'commander/contracts/report.json',revision:'a'.repeat(40)},runtime:{skill_id:skill,entrypoint:'commander'},
    activities:[{key:'read',name:'读回',executor_kind:'code',acceptance:['报告真实'],implementation:{kind:'code',ref:'src/report.js',version:'1.0.0',repo:IMPACT_REPO,path:'src/report.js',revision:'contract'}}]};
  const {source,...doc}=d,proof=await prepareDefinitionFreeze(d,{readFile:async s=>s.path===source.ref?JSON.stringify(doc):'export const ready=true;'});
  await db.query('BEGIN');
  try{const receipt=await registerWorkflow(db,d,{registrationProtocol:'definition-freeze-v1',freezeProof:proof,definitionSha256:registrationDigest(d)});await db.query('COMMIT');return receipt;}
  catch(error){await db.query('ROLLBACK');throw error;}
}
it('同仓显式authoring JSON登记不污染原YAML同步和原scope发布快照',async()=>{
  const internal=await registerInternal();
  await expect(f.sync('a'.repeat(40))).resolves.toBeUndefined();
  const snapshot=await exportImplementationSnapshot(f.db,{scope:'phones',repo:IMPACT_REPO,revision:'a'.repeat(40)});
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');expect(snapshot.definitions.workflows).toHaveLength(2);
  expect(snapshot.definitions.workflows.some(w=>w.workflow_id===internal.workflow_id)).toBe(false);
  const frozen=(await f.db.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[internal.current_definition_version_id])).rows[0];
  expect(frozen.payload.registration_protocol).toBe('definition-freeze-v1');
  expect((await f.db.query('SELECT current_definition_version_id FROM workflows WHERE id=$1',[internal.workflow_id])).rows[0].current_definition_version_id).toBe(frozen.id);
  expect(Number((await f.db.query('SELECT contract_sync_revision FROM workflows WHERE id=$1',[internal.workflow_id])).rows[0].contract_sync_revision)).toBe(0);
});
it('未被显式冻结协议登记的坏JSON来源仍拒绝，不能把null当免责',async()=>{
  await registerInternal();
  await f.db.query("INSERT INTO workflows(key,name,capability_id,channel,source_repo,source_path,status) VALUES('unknown.internal','未知坏来源',$1,'internal',$2,'unknown.json','active')",[f.capabilities[0],IMPACT_REPO]);
  await expect(f.sync('a'.repeat(40))).rejects.toThrow(/来源路径映射无效: unknown.internal/);
});
it.each(['source_path','current_definition_version_id'])('协议标记不能掩盖已漂移的authoring %s',async field=>{
  const internal=await registerInternal();
  await f.db.query(`UPDATE workflows SET ${field}=$2 WHERE id=$1`,[internal.workflow_id,field==='source_path'?'wrong.json':null]);
  await expect(f.sync('a'.repeat(40))).rejects.toThrow(/来源路径映射无效: workflow_report.internal/);
});
