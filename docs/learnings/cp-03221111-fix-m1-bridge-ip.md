# Learning: M1 Tailscale IP 变更后 Bridge 更新

**Branch**: cp-03221111-fix-m1-bridge-ip
**Date**: 2026-03-22

## 发生了什么

西安 M1 重新登录 Tailscale（从 yj408080793@ 切换到 zenithjoy21xx@ 账号），导致 Tailscale IP 从 100.103.88.66 变为 100.88.166.55。executor.js 中 CODEX_BRIDGES 默认值硬编码了旧 IP，导致 Brain 路由到 M1 bridge 失败（连接超时）。

## 经验

1. **Tailscale IP 与账号绑定**：同一设备切换 Tailscale 账号会导致 IP 变更，所有依赖 IP 的配置（plist、executor.js）都需要同步更新。

2. **双重配置更新**：M1 bridge 涉及两处配置
   - `~/Library/LaunchAgents/com.perfect21.codex-bridge.plist`（BRIDGE_HOST）
   - `packages/brain/src/executor.js`（CODEX_BRIDGES 默认值）

3. **快速验证**：更新后立即 `curl http://<新IP>:3458/health` 验证连通性，再推代码。

## 后续

- 如果 M1 再次更换 Tailscale 账号，需要同步更新以上两处配置
- 考虑将 CODEX_BRIDGES 配置外移到环境变量文件，避免硬编码
