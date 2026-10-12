## 比价租约停止与收尾（2026-10-12）

### 根本原因
旧运行副本的心跳吞全部错误；仅杀CLI也不能保证远端固定worker已停。

### 下次预防
- [x] 租约确认作为每个新业务边界前置，409永久拒绝并丢弃迟到结果。
- [x] owner停止标记在固定worker动作入口校验，finally保留恢复网络、桌面与释放锁。
- [x] 清理异步失败必须被close显式返回；Node/Python回归在Phone lease guard CI持续运行。

GP-Anchor: none(infra)

消费者现有源码仍在 Draft 时，运行修复必须以最窄可审查 patch artifact 入 main：固定原/目标哈希、安装前确认运行体为空、备份原文件；实际测试与部署使用同一 artifact，不用未合并本地文件代替生产真身。

有效 task_leases 上线时，旧 watchdog 的 no-run 清理也必须在候选及事务内复核同 owner、未释放、未过期租约；不能只看 claimed_at。有头会话仍在执行却被清 claim 的生产事故由真 PG 测试保留。

工厂改线必须有固定用途 API，避免为单个开关提供任意配置 setter。真实外壳的 launch_exit=0 仅表示启动成功；开启需要已完成业务终态、同 run 系统活动/动作账/收尾与独立 run-verify 核验，复用现有裁判而不从自由文本猜视觉结论。独立 acceptance_run 不会自然生成 factory_judge，不能把不存在的成功字段设成永远无法满足的门槛。
