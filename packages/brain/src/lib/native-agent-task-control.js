import {hasNativeAgentOwner} from './native-agent-authority.js';
import {transaction} from '../execution-directory/store.js';

const reserved=new Set(['native_agent','native_agent_resource_settlement','native_agent_resource_review','standalone_navigation_review_evidence']);
export function assertNativeAgentResultWritable(result){
 if(result&&typeof result==='object'&&Object.keys(result).some(key=>reserved.has(key)))
  throw Object.assign(Error('native_agent_control_reserved'),{statusCode:409});
}
export async function assertNoNativeAgentOwner(pool,taskId){
 if(await hasNativeAgentOwner(pool,taskId))throw Object.assign(Error('native_agent_control_owned'),{statusCode:409});
}
/** 先锁Task，再读最新TaskRun；预约等待期间提交的执行所有权也必须看见。 */
export async function withNativeAgentMutationGuard(pool,taskId,operation){
 return transaction(pool,async db=>{
  await db.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[taskId]);
  await assertNoNativeAgentOwner(db,taskId);
  return operation(db);
 });
}
