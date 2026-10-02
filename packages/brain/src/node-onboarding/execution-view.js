const STAGES=[['execution_probe','核验执行环境'],['execution_credentials','准备节点身份'],['execution_bootstrap','安装执行组件'],['execution_pool','验收资源池'],['execution_script','验收受管脚本'],['execution_active','确认执行就绪']];
const INDEX={probe:0,credentials:1,bootstrap:2,refresh_installation:2,deployment:3,pool_challenge:3,pool_canary:3,pool_attest:3,pool_ready:3,
 script_prepare:4,script_configure:4,script_canary:4,script_activate:4,renew_revoke:3,renew_wait:3,renewal:4,identity:5,active:5,revoked:5};
const ERRORS={linux_pool_onboarding_budget_unavailable:'节点资源不足，无法在保留宿主预算后建立最小执行池',
 linux_pool_credentials_unconfirmed:'节点身份准备尚未确认，系统会读取已有凭据继续核验',
 linux_pool_control_unavailable:'执行接入控制面尚未就绪，系统会继续核验',
 linux_pool_ssh_unavailable:'执行环境未通过核验：需要可信SSH、root权限、systemd、Docker及cgroup v2；系统会自动重试',
 linux_pool_prerequisites_unavailable:'节点执行前置条件未满足，需要Linux、systemd、Docker及cgroup v2'};
export function withLinuxExecution(view,execution={phase:'probe',execution:false}){
 const active=execution.execution===true,index=INDEX[execution.phase]??0;
 return {...view,automatic:execution.phase!=='revoked',status:active?'completed':execution.error?'failed':'in_progress',stage:STAGES[index][0],
  error:execution.error?(ERRORS[execution.error]??'执行验收尚未确认，系统保留当前进度并自动重试'):null,
  capabilities:{...view.capabilities,execution:active},notice:execution.phase==='revoked'?'执行授权已撤销，节点监控继续运行':active?'监控与受管脚本执行已接入；系统会持续核验身份并在授权到期前自动续验':
   ['renew_revoke','renew_wait','renewal','identity'].includes(execution.phase)?'正在核验机器身份和执行授权，核验完成后恢复执行就绪状态':'节点监控已接入，正在自动准备并验收执行能力',
  steps:[...view.steps,...STAGES.map(([key,label],i)=>({key,label,status:active||i<index?'completed':i>index?'pending':execution.error?'failed':'running'}))]};
}
