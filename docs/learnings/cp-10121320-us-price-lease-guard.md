## 比价租约停止与收尾（2026-10-12）

### 根本原因
旧运行副本的心跳吞全部错误；仅杀CLI也不能保证远端固定worker已停。

### 下次预防
- [x] 租约确认作为每个新业务边界前置，409永久拒绝并丢弃迟到结果。
- [x] owner停止标记在固定worker动作入口校验，finally保留恢复网络、桌面与释放锁。
- [x] 清理异步失败必须被close显式返回；Node/Python回归在Phone lease guard CI持续运行。

GP-Anchor: none(infra)
