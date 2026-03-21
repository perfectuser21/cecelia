# Learning: Brain server.js 启动韧性修复

## 上下文
Brain server.js 启动时有三个韧性缺陷：migration 失败直接退出、selfcheck 失败直接退出、uncaughtException 不退出。

### 根本原因
1. migration 失败直接 process.exit(1) 没有重试机制，PG 临时断连就导致 Brain 死亡
2. selfcheck 失败直接退出，而 selfcheck 在 schema 版本不匹配时也会失败，但服务本身可以降级运行
3. uncaughtException handler 只打日志不退出，进程变僵尸无法被 supervisor 重启

### 下次预防
- [ ] 所有启动阶段的外部依赖调用（DB、网络）都应有重试机制
- [ ] 区分"可降级"和"不可降级"的启动检查 — selfcheck 是可降级的
- [ ] uncaughtException 必须 exit 让 supervisor 重启，不能留僵尸进程
