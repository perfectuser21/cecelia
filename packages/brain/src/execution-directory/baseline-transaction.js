const expired=()=>Error('execution_baseline_deadline');
const remaining=deadline=>{const value=deadline-Date.now();if(value<=0)throw expired();return value;};
// 连接超时没有事务副作用；迟到的连接只释放，不会发BEGIN。
async function acquire(pool,deadline){
 const left=remaining(deadline);let abandoned=false,timer;
 try{return await Promise.race([pool.connect().then(client=>{if(abandoned){client.release();throw expired();}return client;}),new Promise((_,reject)=>{timer=setTimeout(()=>{abandoned=true;reject(expired());},left);})]);}
 finally{clearTimeout(timer);}
}
export async function baselineTransaction(pool,deadline,operation){
 const client=await acquire(pool,deadline);let began=false,commitSent=false,destroy=false;
 const query=async(text,values)=>{
  const left=remaining(deadline);
  await client.query({text:"SELECT set_config('statement_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)",values:[`${left}ms`],query_timeout:left});
  const result=await client.query({text,values,query_timeout:remaining(deadline)});
  remaining(deadline);return result;
 };
 try{
  began=true;await client.query({text:'BEGIN',query_timeout:remaining(deadline)});remaining(deadline);
  const event=await operation({query});
  remaining(deadline);
  // 服务端墙钟终端fence也检查总deadline；晚COMMIT不冒称已零写回滚。
  await query(`DO $$ BEGIN IF clock_timestamp()>to_timestamp(${deadline}/1000.0) THEN RAISE EXCEPTION 'execution_baseline_deadline'; END IF; END $$`);
  const left=remaining(deadline);commitSent=true;
  try{
   await client.query({text:'COMMIT',query_timeout:left});
   if(Date.now()>=deadline)return {...event,committed:true,commit_outcome:'confirmed_late',requires_reconciliation:true};
   return {...event,committed:true,commit_outcome:'confirmed'};
  }catch{
   destroy=true;return {...event,committed:null,commit_outcome:'unknown',requires_reconciliation:true};
  }
 }catch(error){
  if(began&&!commitSent){try{await client.query({text:'ROLLBACK',query_timeout:5000});}catch{destroy=true;throw Error('execution_baseline_rollback_unconfirmed');}}
  throw error;
 }finally{client.release(destroy);}
}
