# DoD — 安卓真机测试接入（云端 runner + Tailscale，无需自建）

task_id: cp-07040134-android-realdevice-runner

## 架构决策（与最初设计的变更）

最初方案是在 Mac mini 上自建 self-hosted runner。改为：**GitHub 云端 `ubuntu-latest` runner，用官方 `tailscale/github-action@v2` 临时加入 tailnet**（与现有 `verify-tailscale-brain.yml` 同一模式，复用已有 `TS_AUTHKEY` secret），任务结束即断开连接。

优点：不需要任何专用机器、不需要 sudo 装常驻服务、不给生产机器引入"执行任意 CI 代码"的风险面。

## 交付物

### 1. `.github/workflows/e2e-android-realdevice.yml`
- `workflow_dispatch` 触发，参数：`task_id / sprint_dir / pr_branch / apk_run_id / device_serial`
- runs-on: `ubuntu-latest`（云端，非自建）
- 步骤：Checkout → Tailscale 连接（`tailscale/github-action@v2`）→ 装 adb（`apt-get install android-tools-adb`）→ 设备连通性验证 → APK 下载 → 执行 `e2e-verify-android.sh` → 收集 logcat + 截图

### 2. `packages/engine/runners/android/e2e-verify-android-template.sh`
- Sprint Generator 生成真机 E2E 脚本时的参考模板
- 5 步验收：设备确认 → APK 安装 → 应用重置 → 唤起抖音 + 采集 → 断言（进程存活 + 无崩溃）

## 验收标准

- [x] `e2e-android-realdevice.yml` 改为 `ubuntu-latest` + Tailscale action，不依赖自建 runner
- [x] Tailscale 连接复用现有 `TS_AUTHKEY` secret（已存在，`verify-tailscale-brain.yml` 已在用）
- [x] `adb connect` 步骤支持通过 `device_serial` 输入参数覆盖 secret，便于不设 secret 也能手动测试
- [x] 手机侧已切换到固定端口 `adb tcpip 5555`（不用每次变化的无线调试临时端口）

## 手工配置项（不在代码里，需人工完成，非本 PR 阻塞项）

1. **`HONOR_DEVICE_ADB_TARGET` secret 写入 GitHub repo**：值为 `100.91.227.1:5555`（当前 Honor 测试机 Tailscale IP + 固定 adb 端口）。当前 `gh` CLI 的 PAT 缺少 secrets 写权限（403），需要 Alex 去 GitHub UI 手动设置，或提供权限更全的 PAT。设置前可以用 `device_serial` 输入参数手动测试，不阻塞验证。
2. **手机保持 `adb tcpip 5555` 常开**：手机重启后需要重新执行 `adb tcpip 5555`（可以考虑用 Tasker 之类的工具在开机时自动执行，这个不在本次范围内）。
