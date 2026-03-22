# Learning: M1 Tailscale IP 变更后 Bridge 更新（2026-03-22）

### 根本原因
西安 M1 重新登录 Tailscale 时切换到 zenithjoy21xx@ 账号，导致 Tailscale IP 从 100.103.88.66 变为 100.88.166.55。executor.js CODEX_BRIDGES 默认值和 plist BRIDGE_HOST 硬编码了旧 IP，Brain 路由失败（连接超时 exit code 28）。

### 下次预防
- [ ] M1/M4 重新登录 Tailscale 后，立即检查新 IP（tailscale status），并更新 plist + executor.js CODEX_BRIDGES 默认值
- [ ] 考虑将 CODEX_BRIDGES 配置迁移到环境变量文件（.credentials/bridges.env），避免 IP 硬编码在代码里
