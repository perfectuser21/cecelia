// 普通路由/调度入口不负责注册。dbos-runtime 在 launch 前静态注册真实模块。
export async function startDurableCommonRunner(value) {
  if(process.env.DBOS_DURABLE_ENABLED!=='true')throw Object.assign(Error('common_runner_durable_unavailable'),{status:503});
  const runtime=await import('./common-runner-durable.js');
  return runtime.startDurableCommonRunner(value);
}
