## Brain {VERSION} — Hub 精确绑定本机 Tailscale 地址

- 生产入口只从已校验 manifest 读取本机 Tailscale IPv4:3459；无配置或身份不匹配时退出，不监听所有网卡或回退端口。
- 永久回归覆盖真实入口零监听、私有 ephemeral 端口冲突及地址边界；未安装、未改现场网络、未启用生产 grant。
