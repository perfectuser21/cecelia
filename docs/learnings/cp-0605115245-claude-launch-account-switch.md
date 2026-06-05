## claude-launch.sh 账号切换支持（2026-06-05）

### 根本原因
`claude-launch.sh` 不读取 `~/.claude/.active-account-dir`，导致 `claude-switch cs/cn` 写入文件后 Claude Code 启动时仍用 `~/.claude/`（Keychain 绑定旧账号），切换无效。

### 下次预防
- [ ] 交互式启动器若需支持账号切换，必须在 exec 前读取 CLAUDE_CONFIG_DIR 覆盖文件
- [ ] macOS Keychain 绑定账号是按 config dir 路径 hash，复制 .credentials.json 无法切换账号，必须切换 config dir
- [ ] `CLAUDE_CONFIG_DIR` 已显式设置时不覆盖（保护 Cecelia headless 路径）
