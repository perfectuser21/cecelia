/** 从冻结计划与实际执行段派生对账；不写第二份运行生命周期。 */
const layer=span=>span.enabler_id?'enabler':span.step_id?'step':'activity';
const key=item=>JSON.stringify([item.reference_id,item.activity_id,item.activity_definition_version_id,item.step_id||null]);
const completed=span=>span.ended_at!=null&&Number.isFinite(+new Date(span.ended_at))&&+new Date(span.ended_at)>=+new Date(span.started_at);
// An execution observation stays unknown as a fact. Only an explicitly linked, independent
// validation of the same frozen occurrence may resolve its derived business verdict.
const pairedValidation=(span,spans)=>span.evidence?.kind==='execution'&&typeof span.occurrence_key==='string'
  &&spans.some(v=>v.evidence?.kind==='validation'&&v.outcome==='pass'&&completed(v)
    &&['run_id','run_binding_id','workflow_id','reference_id','workflow_definition_version_id','activity_definition_version_id','activity_id','attempt_key','step_id','enabler_id']
      .every(k=>(v[k]??null)===(span[k]??null))
    &&['profile_digest','task_id','machine_id'].every(k=>typeof span.evidence[k]==='string'&&span.evidence[k]&&v.evidence[k]===span.evidence[k])
    &&v.evidence.execution_occurrences?.includes(span.occurrence_key)
    &&v.evidence.questions?.A4?.source==='independent_validator'&&v.evidence.questions.A4.status==='observed'
    &&v.evidence.questions.A4.actual?.verdict==='pass'&&v.evidence.validation?.verdict==='pass'
    &&typeof v.evidence.questions.A4.ref==='string'&&v.evidence.questions.A4.ref
    &&v.evidence.questions.A4.ref===v.evidence.validation.acceptance_ref
    &&Array.isArray(v.evidence.questions.A4.actual.evidence)&&v.evidence.questions.A4.actual.evidence.length>0
    &&Array.isArray(v.evidence.validation.evidence)&&v.evidence.validation.evidence.length>0);
const observationOnly=span=>['commander','runtime_check'].includes(span.evidence?.kind)
  && typeof span.evidence?.event?.event_type==='string'
  && /^(?:COMMANDER_(?:REQUEST|EXCHANGE|UNAVAILABLE|BUDGET_EXHAUSTED|RECONNECTED|SLEEP)|ACTIVITY_(?:CHECKED|ROUTED|AGENT_EVENT)|WF_OWNER_REVIEW_REQUIRED)$/.test(span.evidence.event.event_type);
const skipEvidence=span=>typeof span.evidence?.skip_reason==='string'&&span.evidence.skip_reason.trim()
  &&span.evidence.branch_evidence!=null&&typeof span.evidence.branch_evidence==='object'&&Object.keys(span.evidence.branch_evidence).length>0;
function durations(spans){
  const result={wall:0,activity:0,step:0,enabler:0},ranges=[];
  for(const span of spans){if(!completed(span))continue;const start=+new Date(span.started_at),end=+new Date(span.ended_at);result[layer(span)]+=end-start;ranges.push([start,end]);}
  ranges.sort((a,b)=>a[0]-b[0]);let cursor=null;
  for(const [start,end] of ranges){if(!cursor||start>cursor[1]){if(cursor)result.wall+=cursor[1]-cursor[0];cursor=[start,end];}else cursor[1]=Math.max(cursor[1],end);}
  if(cursor)result.wall+=cursor[1]-cursor[0];return result;
}
export function reconcileRunEvidence({run_id,context,spans=[],task_run=null,harness_attempts=[]}){
  const binding=context?.binding,gaps=[],missing=[];
  const base={run_id,run_binding_id:binding?.id||null,release_id:binding?.release_id||null,task_run,harness_attempts};
  if(!binding)return {...base,business_outcome:'unknown',evidence_status:'unknown',gaps:[{code:'RUN_BINDING_MISSING'}],missing:[],unexpected:[],duration_ms:durations(spans)};
  const valid=spans.filter(span=>span.identity_protocol===2&&span.run_binding_id===binding.id&&span.run_id===run_id);
  if(valid.length!==spans.length)gaps.push({code:'SPAN_IDENTITY_MISMATCH',count:spans.length-valid.length});
  const expected=binding.expected_path||[],expectedKeys=new Set(expected.map(key));
  if(!expected.length)gaps.push({code:'EXPECTED_PATH_MISSING'});
  for(const item of expected){
    const rows=valid.filter(span=>!observationOnly(span)&&!span.enabler_id&&key(span)===key(item));
    if(!rows.length){missing.push(item);gaps.push({code:item.required===false?'OPTIONAL_BRANCH_EVIDENCE_MISSING':'EXPECTED_SPAN_MISSING',reference_id:item.reference_id,step_id:item.step_id||null});}
  }
  const unexpected=valid.filter(span=>!span.enabler_id&&!expectedKeys.has(key(span))).map(span=>({span_id:span.id,reference_id:span.reference_id,step_id:span.step_id||null}));
  if(unexpected.length)gaps.push({code:'UNEXPECTED_PATH',count:unexpected.length});
  for(const span of valid){
    if(!completed(span))gaps.push({code:'SPAN_NOT_ENDED',span_id:span.id});
    if(span.outcome==='unknown'&&!observationOnly(span)&&!pairedValidation(span,valid))gaps.push({code:'SPAN_OUTCOME_UNKNOWN',span_id:span.id});
    if(span.outcome==='skipped'&&!skipEvidence(span))gaps.push({code:'SKIP_BRANCH_EVIDENCE_MISSING',span_id:span.id});
    if(span.outcome==='skipped'&&expected.some(item=>key(item)===key(span)&&item.required!==false))gaps.push({code:'REQUIRED_PATH_SKIPPED',span_id:span.id});
  }
  const business=valid.filter(span=>!observationOnly(span));
  let outcome=business.some(span=>span.outcome==='fail')?'fail':gaps.length?'unknown':business.some(span=>span.outcome==='skipped')?'skipped':business.length?'pass':'unknown';
  if(task_run?.status==='success'&&outcome==='fail'||['failed','timeout'].includes(task_run?.status)&&outcome==='pass')gaps.push({code:'LIFECYCLE_OUTCOME_CONFLICT',lifecycle_status:task_run.status});
  return {...base,business_outcome:outcome,evidence_status:gaps.length?'incomplete':'verified',gaps,missing,unexpected,duration_ms:durations(valid),span_count:valid.length,expected_count:expected.length};
}
