/** 失败诊断只保存可展示白名单；先脱敏再截断，不凭exit code推测业务根因。 */
export const FAILURE_STATUSES = new Set(['failed','error','timeout']);
export function redactFailureText(value,env={}) {
 let text=String(value??'');
 for(const secret of Object.values(env).filter(v=>typeof v==='string'&&v.length>=3).sort((a,b)=>b.length-a.length))text=text.split(secret).join('***');
 text=text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'***');
 // 日志中的JSON字符串可能再次转义了密码和引号，先按结构脱敏再重编码。
 try{
  const parsed=JSON.parse(text);
  if(parsed&&typeof parsed==='object'){
   const clean=(v,depth=0)=>{
    if(depth>12)return '***';
    if(typeof v==='string')return redactFailureText(v,env);
    if(Array.isArray(v))return v.map(item=>clean(item,depth+1));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,item])=>[k,/token|password|passwd|secret|api[_-]?key|authorization/i.test(k)?'***':clean(item,depth+1)]));
    return v;
   };
   return JSON.stringify(clean(parsed));
  }
 }catch{ /* 普通日志按文本脱敏，不把解析失败当业务失败。 */ }
 // 整段不是JSON时，各行仍可能是JSON回执；普通行继续沿用文本脱敏。
 if(text.includes('\n'))return text.split('\n').map(line=>redactFailureText(line,env)).join('\n');
 return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1***@')
  .replace(/(\b(?:Bearer|Basic)\s+)[a-z0-9._~+/-]+=*/gi,'$1***')
  .replace(/((?:["']?(?:[\w-]*(?:token|password|passwd|secret|api[_-]?key|authorization)[\w-]*)["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;}]+)/gi,'$1***');
}
export function sanitizeWorkflowFailure(value,env={}) {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const result={};let truncated=value.truncated===true;
 const clipped=(text,limit)=>{const safe=redactFailureText(text,env);if(safe.length>limit)truncated=true;return safe.slice(0,limit);};
 for(const [key,limit] of Object.entries({stage:128,code:128,message:1000,host:128,error_type:128,stderr:2000,stdout:2000})){
  if(typeof value[key]==='string'&&value[key].trim())result[key]=clipped(value[key],limit);
 }
 const exit=typeof value.exit_code==='string'&&/^\d{1,3}$/.test(value.exit_code)?Number(value.exit_code):value.exit_code;
 if(Number.isInteger(exit)&&exit>=0&&exit<=255)result.exit_code=exit;
 const timeout=typeof value.timeout_sec==='string'&&/^\d+(?:\.\d+)?$/.test(value.timeout_sec)?Number(value.timeout_sec):value.timeout_sec;
 if(typeof timeout==='number'&&Number.isFinite(timeout)&&timeout>=0&&timeout<=604800)result.timeout_sec=timeout;
 if(Array.isArray(value.evidence)){
  const refs=value.evidence.filter(v=>typeof v==='string'&&v.trim());
  if(refs.length>10)truncated=true;
  result.evidence=refs.slice(0,10).map(v=>clipped(v,500));
 }
 if(truncated||typeof value.truncated==='boolean')result.truncated=truncated;
 return Object.keys(result).some(k=>!['exit_code','evidence','timeout_sec','truncated'].includes(k))?result:null;
}
export function formatWorkflowFailure(failure){
 if(!failure)return null;
 return [failure.stage,failure.code,failure.message,...(failure.evidence||[])].filter(Boolean).join(' · ').slice(0,1900)||null;
}
