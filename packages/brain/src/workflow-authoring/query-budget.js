/** 每轮局部预算：连接迟到释放；查询真实timeout；提交前再检查撤销。 */
export function budgetDatabase(pool,{deadline=Date.now()+15000,signal}={}){
 const check=()=>{if(signal?.aborted||Date.now()>=deadline)throw Object.assign(Error('readiness_deadline_exceeded'),{code:'readiness_deadline_exceeded'});};
 const query=async(target,sql,values)=>{
  const text=typeof sql==='string'?sql:sql.text;
  // 失败清理必须可在预算外回滚，但从不在预算外提交。
  if(text==='ROLLBACK')return target.query({text:'ROLLBACK',query_timeout:5000});
  check();const result=await target.query({...typeof sql==='object'?sql:{text,values},query_timeout:Math.max(1,deadline-Date.now())});
  check();return result;
 };
 return {query:(sql,values)=>query(pool,sql,values),connect:async()=>{
  check();let timedOut=false,timer,abort;
  const pending=pool.connect().then(client=>{if(timedOut){client.release();throw Object.assign(Error('readiness_deadline_exceeded'),{code:'readiness_deadline_exceeded'});}return client;});
  const timeout=new Promise((_,reject)=>{abort=()=>{timedOut=true;reject(Object.assign(Error('readiness_deadline_exceeded'),{code:'readiness_deadline_exceeded'}));};timer=setTimeout(abort,Math.max(1,deadline-Date.now()));signal?.addEventListener('abort',abort,{once:true});});
  let client;try{client=await Promise.race([pending,timeout]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  try{check();}catch(error){client.release();throw error;}
  let poisoned;
  return {release:error=>client.release(error??poisoned),query:async(sql,values)=>{
   try{const result=await query(client,sql,values),text=typeof sql==='string'?sql:sql.text;
   if(/^BEGIN\b/.test(text))await query(client,"SELECT set_config('statement_timeout',$1,true)",[String(Math.max(1,deadline-Date.now()))]);
   return result;}catch(error){poisoned=error;throw error;}
  }};
 }};
}
