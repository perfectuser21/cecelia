# 活跃开发锁回归的外部探活隔离

指标任务 903e 的真实 CI 中，Docker ps 超时后生产按保守规则留下目录并计 skipped_docker_probe=1，旧测试却只认可 skipped_active_lock，导致安全行为被误判。

只隔离该测试文件的 Docker 边界；其他 child_process 命令真实执行，目录、mtime 与 cleanup lock 均用自有临时路径。新增探活失败的真实目录保留断言，保持既有全部安全断言。生产 startup-recovery.js 字节不变，不触其他 worktree 或全局锁。
