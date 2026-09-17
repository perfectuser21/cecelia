## Brain {VERSION} — 手动派发旁路补设备锁

- dispatch-now 与 tasks/:id/dispatch 触发前对 payload.device_serial 任务抢锁：被占 409 / 未注册 422 / fail-closed，闭掉绕过互斥的最后两个 Brain 内入口（Issue e03fc740）
