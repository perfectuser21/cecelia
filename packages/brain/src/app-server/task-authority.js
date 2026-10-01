export const APP_SERVER_AUTHORITY=Symbol('app-server-controller');
export function assertAppServerAuthority(request,context={}){
 const reserved=request.requested_task_type==='app_server_run'||request.task?.task_type==='app_server_run'
  ||request.task?.executor_kind==='app-server-controller'||request.executor_kind==='app-server-controller';
 if(!reserved)return false;
 if(context.appServerAuthority!==APP_SERVER_AUTHORITY||request.requested_task_type!=='app_server_run'
  ||request.task?.executor_kind!=='app-server-controller'||request.source!=='scheduler'
  ||request.declared_domain!=='operations'||request.mutation_intent!=='write'||request.metadata?.policy!=='app-server-exclusive-v1')throw Error('appserver_task_authority_required');
 return true;
}
export async function createGenerationTask({db,home,id}){
 const {createTask}=await import('../actions.js');
 return createTask({db,title:`OpenClaw受管实例 ${home.homeId}`,description:'持久HOME单写与独立generation预约；仅认证精确清理回执释放预算。',
  task_type:'app_server_run',executor_kind:'app-server-controller',status:'in_progress',source:'scheduler',source_id:`app-server:${id}`,
  mutation_intent:'write',declared_domain:'operations',allow_unscoped:true,payload:{policy:'app-server-exclusive-v1',home_key:home.homeKey}},
 {appServerAuthority:APP_SERVER_AUTHORITY});
}
