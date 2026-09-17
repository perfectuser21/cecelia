## Brain {VERSION} — 手机设备资源锁（G5 横切件）

- device_locks 纳管 4 台安卓手机（migration 448，serial 主键 + host/device_type 登记列）
- acquire 原子化（单条 UPDATE + 过期抢占双重判据：expires_at 过期且持有任务已非 in_progress）
- 派发接线：dispatcher 原子 claim 后抢锁（被占 HOL 跳过 / 未注册 fail-fast）+ worker-pool 旁路同接
- 释放：recovery-loop 对账 sweeper（按持有任务非活跃判，uuid 守卫）+ 终态即时释放；新增 POST /device-locks/register 幂等注册
