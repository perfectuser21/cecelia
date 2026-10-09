// 仅数据库中的设备任务与专属执行体组合拥有持久手机租约；payload不能授予所有权。
export function isPhoneDispatchTask(task) {
  return task?.task_type === 'device_job' && task?.executor_kind === 'phone-ssh-controller';
}
