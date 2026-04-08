### 根本原因

Brain 用 `execSync` 阻塞事件循环执行 deploy-local.sh。当 brain-deploy.sh 调用 `launchctl kickstart -k` 重启 Brain 自身时，旧进程因事件循环被占用无法处理 SIGTERM 及时退出，导致新 Brain 进程启动时 `EADDRINUSE :::5221`，FATAL 崩溃。同时 Safe Lane staging 返回 `skipped_no_docker` 状态，CI 不识别（只识别 success/failed/idle），轮询 300s 后超时失败。

### 下次预防

- [ ] Brain 调用自身运维脚本（特别是会重启 Brain 自身的脚本）必须用 `spawn({ detached: true, stdio: 'ignore' })` + `child.unref()`，禁止 `execSync`
- [ ] 脚本向外写状态时（CI 轮询用），写文件 `/tmp/cecelia-deploy-status.json` 而非仅靠内存
- [ ] CI 轮询自定义状态字符串前，先在 yaml 中穷举所有可能值（包含 `skipped_*`），不能只处理 success/failed
- [ ] `deploy-local.sh` 的 `NEED_BRAIN` 检测应排除 `__tests__/` 和 `scripts/`，仅针对 src/ 核心代码触发部署
