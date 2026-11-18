// 完成回调保留5秒冷却，避免任务密集结束时立即填满释放的槽位。
export const CALLBACK_COOLDOWN_MS = 5000;
export function waitForCallbackCooldown() {
  return new Promise(resolve => setTimeout(resolve, CALLBACK_COOLDOWN_MS));
}
