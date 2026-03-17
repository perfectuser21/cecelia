# Learning: startup-recovery 孤儿处理逻辑统一

## 任务
refactor(startup): 统一 startup-recovery.js 与 executor.js 孤儿处理逻辑

### 根本原因
Brain 启动时存在两条并行的孤儿任务处理路径：
- 路径 A（startup-recovery.js）：无条件 UPDATE tasks SET status='queued'，无进程检测
- 路径 B（executor.js::syncOrphanTasksOnStartup）：逐任务进程检测、区分重试/失败、检查 watchdog_retry_count

路径 A 先于路径 B 运行，导致路径 B 的智能逻辑实际找不到 in_progress 任务，等于空转。

### 解决方案
1. 删除 startup-recovery.js 中的 DB 孤儿恢复段
2. runStartupRecovery 只负责三项环境清理（worktrees/lock slots/devmode files），不接受 pool 参数
3. tick.js::initTickLoop 中移除 syncOrphanTasksOnStartup 调用
4. server.js 在 runStartupRecovery 后、initTickLoop 前显式调用 syncOrphanTasksOnStartup

### 下次预防
- [ ] Brain 启动序列变更时，检查是否存在重复调用同功能的两条路径
- [ ] 新增孤儿恢复逻辑时，确认调用位置唯一（server.js 启动序列中显式可见）
- [ ] startup-recovery.js 职责边界：仅环境清理，不含 DB 操作
- [ ] syncOrphanTasksOnStartup 调用位置：仅 server.js（不在 tick.js 内）
