import {definitionDigest} from '../workflow-authoring/contracts.js';
import {ensureVersionForBuild,lockReleaseLine,refreshWorkflowRecipe} from './release-line.js';
export const isAssemblyReconcileEnvironment=(name,env=process.env)=>name==='cecelia_scratch' || name==='cecelia_test' && env.CI==='true' && env.GITHUB_ACTIONS==='true';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const deny=code=>{throw Object.assign(Error(code),{assemblyGap:code});};
function fixed(row){
  if(!row || row.contract_sha256!==definitionDigest(row.payload?.contract)
    || row.payload_sha256!==definitionDigest({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload}))deny('candidate_source_unverified');
}

/** 仅候选的不可变来源派生信息。调用者已有事务时显式传existing；不移动任何发布指针。 */
export async function auditAssemblyDerivations(db,task,options={}){
  const owns=options.transaction!=='existing',check=options.check ?? (()=>{});
  const out={gaps:[],detected:[],repaired:[]},gap=(code,slot=null)=>{
    const item=slot?{code,activity_key:slot}:{code};out.gaps.push(item);out.detected.push(item);
  };
  check();await db.query(owns?'BEGIN':'SAVEPOINT assembly_reconcile_derived');
  try{
    const actual=(await db.query('SELECT current_database() AS name')).rows[0]?.name;check();
    if(!isAssemblyReconcileEnvironment(actual) || options.database && options.database!==actual)deny('candidate_environment_unsupported');
    const state=task.result?.workflow_authoring,definition=state?.outputs?.compose?.definition;
    const owner=task.result?.workflow_authoring_candidate,tenant=task.tenant_id ?? task.payload?.tenant_id ?? 'default';
    if(state?.request?.execution_protocol!=='workflow-authoring-execution-v1' || state.request.assembly_mode!==true
      || state.request.registration_protocol!=='definition-freeze-v1')deny('execution_protocol_required');
    if(!owner || owner.protocol!=='workflow-authoring-execution-v1' || owner.authoring_task_id!==task.id
      || owner.tenant_id!==tenant || task.tenant_id && task.payload?.tenant_id && task.tenant_id!==task.payload.tenant_id
      || owner.definition_sha256!==definitionDigest(definition) || !UUID.test(owner.workflow_id) || !UUID.test(owner.workflow_definition_version_id))deny('candidate_owner_mismatch');
    const claims=(await db.query("SELECT id FROM tasks WHERE result#>>'{workflow_authoring_candidate,workflow_id}'=$1",[owner.workflow_id])).rows;check();
    if(claims.length!==1 || claims[0].id!==task.id)deny('candidate_owner_mismatch');
    const workflow=(await db.query('SELECT * FROM workflows WHERE id=$1 FOR SHARE',[owner.workflow_id])).rows[0];check();
    const version=(await db.query('SELECT * FROM workflow_definition_versions WHERE id=$1 AND workflow_id=$2',[owner.workflow_definition_version_id,owner.workflow_id])).rows[0];check();fixed(version);
    if(!workflow || workflow.status!=='paused' || workflow.current_definition_version_id!==version.id
      || version.payload.assembly_mode!==true || version.payload.workflow_id!==workflow.id || workflow.key!==definition.key
      || workflow.source_repo!==version.source_repo || workflow.source_path!==version.source_path
      || version.source_repo!==definition.source?.repo || version.source_path!==definition.source?.ref || version.source_commit!==definition.source?.revision
      || version.contract_sha256!==owner.definition_sha256)deny('candidate_source_unverified');
    const released=(await db.query(`SELECT id FROM release_versions r WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'workflows') w
      WHERE w->>'workflow_id'=$1 OR w->>'id'=$2) LIMIT 1`,[workflow.id,version.id])).rows;check();
    if(released.length)deny('candidate_formal_release_conflict');
    const slots=version.payload.activities;
    if(!Array.isArray(slots) || !slots.length || slots.length>100 || slots.length!==owner.slots?.length)deny('candidate_source_unverified');
    const refs=(await db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=$1 ORDER BY sequence_no',[workflow.id])).rows;check();
    if(refs.some(r=>!slots.some(s=>s.slot_key===r.slot_key)))deny('fixed_reference_conflict');
    const expected=[],missing=[];
    for(const [index,slot] of slots.entries()){
      check();const own=owner.slots[index];
      if(!UUID.test(slot.reference_id) || !UUID.test(slot.activity_id) || !UUID.test(slot.activity_version_id)
        || slot.sequence_no!==index+1 || own.slot_key!==slot.slot_key || own.activity_id!==slot.activity_id
        || own.activity_definition_version_id!==slot.activity_version_id)deny('candidate_source_unverified');
      const live=(await db.query('SELECT * FROM activities WHERE id=$1 FOR SHARE',[slot.activity_id])).rows[0];check();
      const contract=definition.activities?.[index],reused=contract?.reuse_activity_id===slot.activity_id
        && contract.reuse_activity_definition_version_id===slot.activity_version_id;
      if(!live || (reused?!['planned','active'].includes(live.status):live.status!=='planned'||live.workflow_id!==workflow.id))deny('candidate_activity_state_conflict');
      if(!reused){
        const production=(await db.query('SELECT activity_id FROM activity_release_state WHERE activity_id=$1',[slot.activity_id])).rows;check();
        if(production.length)deny('candidate_formal_release_conflict');
      }
      const activity=(await db.query('SELECT * FROM activity_definition_versions WHERE id=$1 AND activity_id=$2',[slot.activity_version_id,slot.activity_id])).rows[0];check();fixed(activity);
      if(activity.payload.activity_id!==slot.activity_id)deny('candidate_source_unverified');
      for(const step of activity.payload.steps ?? []){
        if(!UUID.test(step.step_id))deny('fixed_step_unverified');
        const stored=(await db.query('SELECT activity_id,active,source_sha256 FROM steps WHERE id=$1',[step.step_id])).rows[0];check();
        if(!stored || stored.activity_id!==slot.activity_id || stored.active===false
          || step.source_sha256 && stored.source_sha256!==step.source_sha256)gap('fixed_step_missing',slot.slot_key);
      }
      let mapping=(await db.query(`SELECT m.activity_version_id,v.content_md5,v.activity_id,
        md5((d.payload-'implementation_bindings')::text) AS expected_md5 FROM activity_version_builds m
        JOIN activity_versions v ON v.id=m.activity_version_id JOIN activity_definition_versions d ON d.id=m.build_id
        WHERE m.build_id=$1 AND m.activity_id=$2`,[activity.id,slot.activity_id])).rows[0];check();
      if(!mapping){
        gap('fixed_build_missing',slot.slot_key);
        if(options.repair){check();await lockReleaseLine(db);check();const built=await ensureVersionForBuild(db,activity.id);check();
          if(!built.version)deny('fixed_build_unverified');
          mapping={activity_version_id:built.version.id,activity_id:slot.activity_id,content_md5:built.version.content_md5,expected_md5:built.version.content_md5};
          out.repaired.push({code:'fixed_build_missing',activity_key:slot.slot_key});out.gaps.pop();
        }
      }
      if(mapping && (mapping.activity_id!==slot.activity_id || mapping.content_md5!==mapping.expected_md5))deny('fixed_build_conflict');
      if(mapping)expected.push({slot_key:slot.slot_key,sequence_no:slot.sequence_no,activity_id:slot.activity_id,activity_version_id:mapping.activity_version_id,content_md5:mapping.content_md5});
      const ref=refs.find(r=>r.slot_key===slot.slot_key);
      if(!ref){
        const occupied=(await db.query('SELECT id FROM workflow_activity_refs WHERE id=$1',[slot.reference_id])).rows;check();
        if(occupied.length || refs.some(r=>r.active && r.sequence_no===slot.sequence_no))deny('fixed_reference_conflict');
        gap('fixed_reference_missing',slot.slot_key);missing.push(slot);
      }else if(ref.active!==true || ref.id!==slot.reference_id || ref.activity_id!==slot.activity_id
        || ref.activity_definition_version_id!==slot.activity_version_id || ref.sequence_no!==slot.sequence_no
        || ref.source_repo!==version.source_repo || ref.source_path!==version.source_path
        || ref.source_commit && ref.source_commit!==version.source_commit)deny('fixed_reference_conflict');
    }
    if(options.repair && missing.length && expected.length===slots.length && !out.gaps.some(g=>g.code!=='fixed_reference_missing')){
      for(const slot of missing){
        check();await db.query(`INSERT INTO workflow_activity_refs(id,workflow_id,slot_key,activity_id,activity_definition_version_id,sequence_no,source_repo,source_path,source_commit)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[slot.reference_id,workflow.id,slot.slot_key,slot.activity_id,slot.activity_version_id,slot.sequence_no,version.source_repo,version.source_path,version.source_commit]);check();
        out.repaired.push({code:'fixed_reference_missing',activity_key:slot.slot_key});
      }
      out.gaps=out.gaps.filter(g=>g.code!=='fixed_reference_missing');
    }
    const recipe=(await db.query('SELECT recipe FROM workflow_production_recipes WHERE workflow_id=$1 ORDER BY id DESC LIMIT 1',[workflow.id])).rows[0]?.recipe;check();
    if(!recipe){
      gap('recipe_missing');
      if(options.repair && !out.gaps.some(g=>g.code!=='recipe_missing') && expected.length===slots.length){
        check();await lockReleaseLine(db);check();await refreshWorkflowRecipe(db,workflow.id,{cause:'assembly_reconcile'});check();
        const reread=(await db.query('SELECT recipe FROM workflow_production_recipes WHERE workflow_id=$1 ORDER BY id DESC LIMIT 1',[workflow.id])).rows[0]?.recipe;check();
        if(definitionDigest(reread)!==definitionDigest(expected))deny('recipe_unverified');
        out.repaired.push({code:'recipe_missing'});out.gaps=out.gaps.filter(g=>g.code!=='recipe_missing');
      }
    }else if(expected.length!==slots.length || definitionDigest(recipe)!==definitionDigest(expected))deny('recipe_conflict');
    if(out.gaps.length && out.repaired.length)throw Object.assign(Error('derived_repair_incomplete'),{assemblyGaps:out.detected});
    check();await db.query(owns?'COMMIT':'RELEASE SAVEPOINT assembly_reconcile_derived');return out;
  }catch(error){
    await db.query(owns?'ROLLBACK':'ROLLBACK TO SAVEPOINT assembly_reconcile_derived');
    if(!owns)await db.query('RELEASE SAVEPOINT assembly_reconcile_derived');
    if(!error.assemblyGap && !error.assemblyGaps)throw error;
    const gaps=error.assemblyGaps ?? [...out.detected,{code:error.assemblyGap}];
    return {gaps,detected:gaps,repaired:[]};
  }
}
