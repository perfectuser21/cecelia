/** 263原始空队列只完成调度控制任务，不把未发送的required路径改成PASS。 */
export function verifiedEmptyOutreach(plan,receipt,context,spans,reconciliation){
  if(plan.workflow_key!=='douyin_lead_outreach')return false;
  const results=receipt.split_result?.results;
  if(!Array.isArray(results)||results.length!==4||new Set(results.map(r=>r.activity)).size!==4)return false;
  const stage=key=>results.find(r=>r.activity===key),pre=stage('preflight'),send=stage('send_dm'),write=stage('write_back'),clean=stage('cleanup');
  if(pre?.status!=='completed'||pre.verification?.verified!==true||pre.result?.outreach_policy_verified!==1||pre.result?.send_authorized!==1||pre.result?.account_verified!==true)return false;
  if(send?.status!=='skipped'||send.result?.status!=='skipped'||send.result.reason!=='没有符合合同的未发送订单'||send.result.sent!==0||send.result.messages_sent_while_paused!==0||Object.keys(send.result).some(k=>!['status','reason','sent','messages_sent_while_paused'].includes(k)))return false;
  if(write?.status!=='skipped'||write.result?.status!=='skipped'||write.result.reason!=='无新发送事实，保留待核实'||write.result.outreach_readback_failures!==0)return false;
  if(clean?.status!=='completed'||clean.verification?.verified!==true||clean.result?.lock_released!==1||clean.result.safe_desktop_visible!==1||!Array.isArray(clean.result.failures)||clean.result.failures.length)return false;
  const binding=context.binding,refs=context.workflow?.payload?.activities||[];
  const emptyRefs=new Set(refs.filter(r=>['send_dm','write_back'].includes(r.slot_key)).map(r=>r.reference_id));
  if(emptyRefs.size!==2||!spans.length)return false;
  for(const span of spans){
    if(span.identity_protocol!==2||span.run_binding_id!==binding.id||span.run_id!==plan.business_run_id||span.evidence?.runtime_snapshot_sha256!==binding.payload?.runtime_snapshot_sha256)return false;
    if(span.outcome!=='pass'&&!(span.outcome==='skipped'&&emptyRefs.has(span.reference_id)&&!span.step_id&&!span.enabler_id))return false;
  }
  for(const ref of emptyRefs)if(!spans.some(s=>s.reference_id===ref&&!s.step_id&&!s.enabler_id&&s.outcome==='skipped'))return false;
  // 只允许确切空发送/空写回带来的缺步骤与skipped原事实；其他缺失、未知、来源/路径异常均拒绝。
  return reconciliation.gaps.every(g=>{
    if(g.code==='EXPECTED_SPAN_MISSING')return Boolean(g.step_id)&&emptyRefs.has(g.reference_id);
    if(['SKIP_BRANCH_EVIDENCE_MISSING','REQUIRED_PATH_SKIPPED'].includes(g.code))return spans.some(s=>s.id===g.span_id&&emptyRefs.has(s.reference_id)&&!s.step_id&&!s.enabler_id&&s.outcome==='skipped');
    return false;
  });
}
