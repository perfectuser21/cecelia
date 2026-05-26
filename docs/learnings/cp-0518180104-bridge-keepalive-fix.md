## bridge keepalive 修复 + brain-keepalive SILENCED bug（2026-05-18）

### 根本原因

**Brain-keepalive SILENCED 永久静默**：`brain-keepalive-check.sh` 第 28-33 行，docker daemon 不可用时和"重启失败"共用同一个 `STATE_FILE`（`/tmp/brain-keepalive.alerting`）。一旦 touch，后续所有 cron 运行均进入 SILENCED 分支（第 45-47 行），该分支无超时、无重试、无升级逻辑，导致 Brain 持续宕机期间产生 156+ 条 SILENCED 日志且无一有效告警。

**cecelia-bridge 无主动 keepalive**：`com.cecelia.bridge.plist` 只有被动 `KeepAlive: true`，依赖 launchd throttle。bridge 进程被 kill 后，launchd 有指数退避延迟；期间无任何告警，无可见性。实测 bridge 宕机 3 天无人知晓，所有 harness_initiative 任务以 `no_executor` 回滚到 queued 堆积。

### 下次预防

- [ ] 任何使用 STATE_FILE 触发静默的脚本，**必须**有 TTL 超时机制（推荐 5 分钟）；STATE_FILE 永久存在 = 系统盲区
- [ ] `docker daemon unavailable` 是临时状态，**不应**污染"重启失败"的 STATE_FILE；两种失败模式需独立 state file
- [ ] 新增关键进程（port 监听型）时，**必须**同时创建对应的主动 keepalive 检查脚本（镜像 brain-keepalive 模式）
- [ ] keepalive 脚本中的 restart 路径应测试两种场景：launchctl 可用（已有 plist）和不可用（direct spawn fallback）
- [ ] 飞书 P0 告警的 STATE_FILE 路径应与脚本同名命名（`/tmp/<service>-keepalive.alerting`），避免多脚本命名碰撞
