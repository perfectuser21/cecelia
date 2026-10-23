/** 发布来源验证总预算；取消真实Git请求，数据库临界区另有更短的服务端边界。 */
export function createReleaseValidationBudget({signal,timeoutMs=25000}={},makeError){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw makeError('INPUT_INVALID','发布验证时限无效');
  const controller=new AbortController(),deadline=Date.now()+Math.min(timeoutMs,25000);
  const abort=()=>controller.abort(makeError('REQUEST_ABORTED','发布请求已断开',499));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(makeError('VALIDATION_TIMEOUT','发布来源验证超时',504)),Math.max(1,deadline-Date.now()));
  const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
  return {
    signal:controller.signal,deadline,check,makeError,
    // 不合作的外部依赖也不能把API或数据库连接留在等待状态；迟到结果不再进入写入阶段。
    wait(promise,onLate){
      return new Promise((resolve,reject)=>{
        let aborted=false;
        const stop=()=>{aborted=true;reject(controller.signal.reason);};
        if(controller.signal.aborted)stop();else controller.signal.addEventListener('abort',stop,{once:true});
        Promise.resolve(promise).then(value=>{
          controller.signal.removeEventListener('abort',stop);
          if(aborted)onLate?.(value);else resolve(value);
        },error=>{controller.signal.removeEventListener('abort',stop);if(!aborted)reject(error);});
      });
    },
    close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);},
  };
}

/** 这里只允许数据库操作：锁外Git验证不得放进回调。连接取消/超时以销毁socket回滚。 */
export async function releaseValidationTransaction(pool,budget,fn,{readOnly=false,key}={}){
  budget.check();
  const client=await budget.wait(pool.connect(),late=>late.release(true));
  let released=false,transactionError;
  const destroy=()=>{if(!released){released=true;client.release(true);}};
  const onError=error=>{transactionError ||= error;destroy();};
  client.on?.('error',onError);
  const abort=()=>destroy();
  budget.signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{
    transactionError=budget.makeError('TRANSACTION_TIMEOUT','发布登记临界区超时',503);destroy();
  },Math.max(1,Math.min(5000,budget.deadline-Date.now())));
  const db={query:async(...args)=>{
    budget.check();if(transactionError)throw transactionError;
    return client.query(...args);
  }};
  try{
    budget.check();
    await db.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
    await db.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true)",['2000ms','1000ms','3000ms']);
    if(key)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
    const result=await fn(db);budget.check();
    await db.query('COMMIT');return result;
  }catch(error){
    if(!released)try{await client.query('ROLLBACK');}catch{destroy();}
    if(budget.signal.aborted)throw budget.signal.reason;
    if(['55P03','57014','25P03'].includes(error.code))throw budget.makeError('TRANSACTION_TIMEOUT','发布数据库核验超时',503);
    throw transactionError||error;
  }finally{
    clearTimeout(timer);budget.signal.removeEventListener('abort',abort);client.off?.('error',onError);
    if(!released){released=true;client.release();}
  }
}
