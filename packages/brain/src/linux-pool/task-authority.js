export const LINUX_POOL_EXECUTOR_KIND='linux-pool-controller';
export const LINUX_POOL_AUTHORITY=Symbol(LINUX_POOL_EXECUTOR_KIND);
/** 专用kind只能由同进程controller铸造，公开payload/created_by没有授权含义。 */
export function assertLinuxPoolAuthority(request,context={}){
 const reserved=request.task?.executor_kind===LINUX_POOL_EXECUTOR_KIND||request.executor_kind===LINUX_POOL_EXECUTOR_KIND;
 if(!reserved)return false;
 if(context.linuxPoolAuthority!==LINUX_POOL_AUTHORITY||request.requested_task_type!=='audit'
  ||request.task?.executor_kind!==LINUX_POOL_EXECUTOR_KIND||request.source!=='scheduler'
  ||request.declared_domain!=='operations'||request.mutation_intent!=='read_only')throw Error('linux_pool_task_authority_required');
 return true;
}
