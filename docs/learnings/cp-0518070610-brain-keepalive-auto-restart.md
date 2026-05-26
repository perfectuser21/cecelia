## Brain keepalive 自动重启（2026-05-18）

### 根本原因

keepalive 脚本最初只发告警，依赖人工介入。`restart: unless-stopped` 只对容器崩溃有效；当 `brain-deploy.sh` 执行 `docker rm -f` 删除容器后，Docker 无对象可重启，Brain 从 `docker ps -a` 彻底消失。

### 下次预防

- [ ] keepalive 脚本必须内含自动重启逻辑，不能只发告警
- [ ] 用 REPO_ROOT 变量定位 docker-compose.yml，避免 launchd 环境路径问题
- [ ] state file 防重：重启失败后 SILENCED，防每分钟循环重启
- [ ] 加 docker daemon 预检，daemon 不可用时直接告警，不盲目调 docker 命令
