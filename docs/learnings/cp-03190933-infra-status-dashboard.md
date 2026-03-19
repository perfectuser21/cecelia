---
branch: cp-03190933-infra-status-dashboard
pr: 1109
date: 2026-03-19
---

# Learning: Fleet Monitor — 全设备状态面板

## 做了什么
在 Dashboard /system/infra 页面新增 Fleet 标签页，展示 7 台设备（美国 Mac mini M4、美国 VPS、香港 VPS、西安 Mac mini M1/M4、西安 PC、NAS）的实时状态。Brain 侧新增 `/api/brain/infra-status/servers` API，通过 Tailscale SSH 并行采集远程设备数据。

## 关键决策
- **复用 InfrastructureMonitor 标签页**而非独立页面：保持 /system/infra 的统一入口，新增 Fleet 标签为默认首选
- **SSH 并行采集 + Promise.allSettled**：某台设备离线不阻塞其他设备数据返回
- **单次 SSH 执行多命令**：用 `echo "---MARKER---"` 分隔，一次连接采集所有数据，减少 SSH 握手开销

### 根本原因
现有 VpsMonitor 只通过 `os` 模块监控本机，缺乏远程设备可见性。用户需要一个统一面板查看整个基础设施集群健康。

### 下次预防
- [ ] 跨平台 SSH 采集需注意 macOS vs Linux 命令差异（`nproc` vs `sysctl -n hw.ncpu`、`/proc/meminfo` vs `vm_stat`）
- [ ] Windows SSH 采集用 `wmic` 命令，但 Windows SSH 可能未配置，需要降级处理
- [ ] SSH 超时设 5 秒（ConnectTimeout），总请求超时 8 秒，避免拖慢整个 API 响应
