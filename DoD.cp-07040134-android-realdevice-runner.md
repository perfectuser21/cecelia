# DoD — Self-hosted 安卓真机测试接入

task_id: cp-07040134-android-realdevice-runner
branch: cp-07040134-zj-bluegreen-guardrail-bark

## 交付物

### 1. `.github/workflows/e2e-android-realdevice.yml`
- `workflow_dispatch` 触发，参数：`task_id / sprint_dir / pr_branch / apk_run_id / device_serial`
- runs-on: `[self-hosted, mac-mini, android]`
- 步骤：设备连通性验证 → APK 下载（来自上游 run 的 artifact）→ 执行 sprint 目录的 `e2e-verify-android.sh` → 收集 logcat + 截图

### 2. `packages/engine/runners/android/e2e-verify-android-template.sh`
- Sprint Generator 生成真机 E2E 脚本时的参考模板
- 5 步验收：设备确认 → APK 安装 → 应用重置 → 唤起抖音 + 采集 → 断言（进程存活 + 无崩溃）

### 3. `packages/engine/runners/android/setup-mac-mini-runner.sh`
- Mac mini 注册 self-hosted runner 的一次性脚本
- 检查 adb / Tailscale → 下载 runner → config + launchd 服务安装

## 验收标准

- [ ] `e2e-android-realdevice.yml` 可被 evaluator SKILL 以 `target_environment=android_realdevice` 触发
- [ ] runner label `[self-hosted, mac-mini, android]` 与 Mac mini 注册时 `--labels` 一致
- [ ] `HONOR_DEVICE_ADB_TARGET` secret 设置后，`adb connect` 步骤能连上 Honor 手机
- [ ] APK artifact 来自 Task 6 build run，通过 `apk_run_id` 参数传入后能正确下载安装
- [ ] 脚本完成后 `screenshots/` 目录有截图和 logcat，上传为 GitHub artifact

## 手工配置项（不在代码里，需人工完成）

1. 在 Mac mini 上跑 `setup-mac-mini-runner.sh`，注册 runner（runner name: `mac-mini-android-runner`）
2. 在 GitHub repo Settings → Secrets 写入 `HONOR_DEVICE_ADB_TARGET`（格式：`<tailscale-ip>:5555`）
3. Honor 手机端持续保持 `adb tcpip 5555`（重启后需重新执行，建议用 Tasker 自动化）
