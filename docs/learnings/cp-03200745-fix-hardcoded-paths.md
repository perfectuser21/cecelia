# Learning: Linux→macOS 硬编码路径清理
## 分支
`cp-03200745-fix-hardcoded-paths`
### 根本原因
从 Linux 迁移到 macOS 后，多处硬编码了旧路径：~/.local/bin/claude、~/.local/bin/notebooklm、/home/cecelia/.credentials。
### 下次预防
- [ ] 外部命令路径一律用环境变量 + 合理默认值，不硬编码
- [ ] 迁移平台后全局搜 /home/ 和 .local/bin 确认无残留
