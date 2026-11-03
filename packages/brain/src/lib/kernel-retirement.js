/** Kernel 仅保留历史读回与在途善后；新业务须绑定公共 Runner profile。 */
export function kernelRuntimeRetiredError() {
  return Object.assign(new Error('kernel_runtime_retired: 新业务请迁移公共Runner的固定workflow/profile；禁止重启旧kernel'), {code:'kernel_runtime_retired', status:410, statusCode:410});
}
