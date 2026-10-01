## Brain {VERSION} — Walking真实CI恢复验收（原任务617259ae）

- Walking仅显式授权且实际checkpointer URI与安全测试目标一致才写；专用CI运行真实Docker、回调与PG正例，real-env RunAll 明确委托而不冒充通过。
- 狭窄CI重启控制以每进程随机令牌为屏障；回调有界重试，真实PG interrupt跨同容器重启恢复，同线程完成事件恰一次，总预算260秒。
- 生产默认回调地址与通用callback幂等策略保持；生产或未知重启控制在checkpoint或Docker前拒绝，无通用执行权限扩展。
