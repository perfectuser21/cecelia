/** 普通任务夹具：守卫事务与业务SQL分流，不消费原业务响应队列。 */
export function taskMutationFixturePool(query){
 const scoped=async(sql,params)=>{
  if(/^(BEGIN|COMMIT|ROLLBACK)(?:\s|$)/.test(sql))return {rows:[]};
  if(sql==='SELECT id FROM tasks WHERE id=$1 FOR UPDATE')return {rows:[]};
  if(sql.includes('AS native_owned'))return {rows:[{native_owned:false}]};
  if(sql==="SELECT payload->'headed_takeover' AS headed_takeover FROM tasks WHERE id=$1")return {rows:[]};
  return query(sql,params);
 };
 return {query:scoped,connect:async()=>({query:scoped,release:()=>{}})};
}
