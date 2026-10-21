import {Buffer} from 'node:buffer';

/** 只读研究无需网络即可看到原失败事实；严格选字段，不复制业务输入或整份payload。 */
export function diagnosisFacts(control, failure, sources) {
  let truncated = false;
  const text = (value, max = 512) => {
    if (typeof value !== 'string') return undefined;
    if (value.length > max) truncated = true;
    return value.slice(0, max * 4)
      .replace(/\b(?:proxy-authorization|authorization|set-cookie|cookie)["']?\s*:\s*[^\r\n]*/gi, '[redacted-header]')
      .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
      .replace(/\b[A-Za-z_]*(?:token|secret|password|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*["']?[^\s"'&,;]+/gi, '[redacted]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/g, '[redacted-private-key]')
      .replace(/\b1[3-9]\d{9}\b/g, '[redacted-phone]')
      .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/https?:\/\/[^\s"'<>]+/g, url => url.split(/[?#]/)[0].replace(/\/\/[^/]*@/, '//[redacted]@'))
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .slice(0, max);
  };
  const entries = (value, limit = 8) => {
    if (!Array.isArray(value)) return [];
    if (value.length > limit) truncated = true;
    return value.slice(0, limit);
  };
  const refs = value => entries(value).map(v => typeof v === 'string' ? text(v, 256) : v && typeof v === 'object'
    ? {ref:text(v.ref,256),path:text(v.path,256),url:text(v.url,256),sha256:text(v.sha256,64)} : null).filter(Boolean);
  const e = control.envelope, d = control.delivery, v = control.verification;
  const context = {
    schema_version:'commander-diagnosis-facts/v1', workflow_key:text(e.workflow_key,200),run_id:text(e.run_id,200),
    definition:text(e.definition.snapshot_sha256,128),runtime_snapshot_sha256:text(e.definition.runtime_snapshot_sha256,128),
    release_id:text(e.definition.release_id,128),error_fingerprint:text(failure.error_fingerprint,128),reason:text(failure.reason,512),
    delivery:d ? {status:text(d.status,64),failure:d.failure ? {reason:text(d.failure.reason,512),code:text(d.failure.code,128),message:text(d.failure.message,1024),stack:text(d.failure.stack,2048)} : undefined,
      effects:entries(d.effects).map(x=>({key:text(x.key,128),status:text(x.status,64),evidence:refs(x.evidence)})),
      cleanup:d.cleanup ? {completed:d.cleanup.completed===true,evidence:refs(d.cleanup.evidence)} : undefined} : undefined,
    verification:v ? {verdict:text(v.verdict,64),assertions:entries(v.assertions).map(a=>({name:text(a.name,128),pass:a.pass===true,
      status:text(a.status,64),detail:text(a.detail,512),evidence:refs(a.evidence)})),evidence:refs(v.evidence)} : undefined,
    evidence:refs(v?.evidence),
    frozen_sources:entries(sources,24).map(s=>({repo:text(s.repo,128),revision:text(s.revision,40),...(s.path?{path:text(s.path,512)}:{})})),
  };
  // Unicode和JSON转义按真实字节计；超预算只删尾部明细，保留失败与固定身份。
  const arrays=[];
  const collect=value=>{
    if(Array.isArray(value))arrays.push(value);
    if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);
  };
  collect(context);
  const bytes=()=>Buffer.byteLength(JSON.stringify(context));
  while(bytes()>23000){
    const largest=arrays.filter(a=>a.length).sort((a,b)=>Buffer.byteLength(JSON.stringify(b))-Buffer.byteLength(JSON.stringify(a)))[0];
    if(largest){largest.pop();truncated=true;continue;}
    // JSON转义后的标量也可能超预算；只删诊断明细，保留固定身份。
    const detail=['stack','message','reason'].find(key=>context.delivery?.failure?.[key]!==undefined);
    if(detail){delete context.delivery.failure[detail];truncated=true;continue;}
    if(context.reason!==undefined){delete context.reason;truncated=true;continue;}
    throw Error('diagnosis_facts_budget_exceeded');
  }
  context.truncated=truncated;
  context.evidence_status=context.evidence.length?'recorded_refs_only':'insufficient_evidence';
  if(bytes()>24000)throw Error('diagnosis_facts_budget_exceeded');
  return context;
}
