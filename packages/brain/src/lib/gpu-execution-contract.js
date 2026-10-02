// 观测不授予 GPU 执行能力；明确声明不能在 CPU 派发时被丢弃。
export function hasGpuExecutionRequest(payload) {
  return payload !== null && typeof payload === 'object' && (
    Object.hasOwn(payload, 'gpu') ||
    (payload.runtime_resources !== null && typeof payload.runtime_resources === 'object' && Object.hasOwn(payload.runtime_resources, 'gpu'))
  );
}
export const GPU_EXECUTION_MESSAGE = 'GPU 执行能力尚未验收，不能按普通 CPU 任务派发';
export function assertGpuExecutionSupported(payload) {
  if (hasGpuExecutionRequest(payload)) {
    throw Object.assign(new Error(GPU_EXECUTION_MESSAGE), {code: 'gpu_execution_unsupported', status: 400});
  }
}
