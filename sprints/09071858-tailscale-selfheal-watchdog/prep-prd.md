# Bug PrepPRD：Tailscale 扩展卡死→enforcer 拉闸→整机断网（xian-m4 2026-09-07）

## 症状
xian-m4 WiFi 正常、Tailscale 图标显示连接，但整机无法出网 27 分钟（18:04-18:31），人工重启才恢复。

## 根因（已确诊，证据在会话）
1. 直接原因：Tailscale macsys network-extension（1.102.3）内部卡死——进程存活但 localapi（127.0.0.1:49701 / unix socket）与 control 连接全部无响应。
2. 放大器：tailscale-us-exit-enforcer 检测到 daemon_absent 连续超过阈值，按设计 fail-closed pf 拉闸，把"Tailscale 挂"放大为"整机断网"。
3. 伴随发现：enforcer 连续失败计数器起跳值为 51（应为 1），存在跨事故残留（清零逻辑 bug）；perfect21 login-watchdog 重认证时 tailscale up 未带 --advertise-exit-node，冲掉了 primary 出口广播（已手动恢复，需修脚本防复发）。

## 修法（三件事，一个 PR）
1. 新增 `scripts/ops/tailscale-health-watchdog.py` + launchd plist + 安装脚本：每 60s 用带超时的 `tailscale status --json` 探测；连续 3 次失败/超时 → 重启 Tailscale.app（杀 GUI 进程重新 open），带冷却期（10 分钟内最多重启 1 次，连续 3 轮重启无效则停手只告警日志）。部署 xian-m4 与 xian-m1。
2. 修 `scripts/ops/tailscale-us-exit-enforcer.py` 计数器清零逻辑：定位为何跨事故残留 50，成功 tick 必须同时清零两个计数文件。
3. 修 perfect21 login-watchdog（scripts/ops/tailscale-login-watchdog.py）：重认证后恢复/保留 --advertise-exit-node。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| Tailscale 卡死判定 | a) status --json 超时 b) BackendState!=Running c) socket 存在性 | a+b：15s 超时调 status --json，失败或 BackendState!=Running 计一次，连续 3 次判卡死 | 本次故障中 localapi 无响应是最早可观测信号；socket 路径在 macsys 变体不可靠（正常时也不存在） | 误判多重启一次 Tailscale，约 40s 网络抖动，后果轻 |

## 时序兼容性（关键约束）
watchdog 3 分钟检测 + ~40s 重启恢复 < enforcer daemon_absent 宽松阈值 10 分钟 → 自愈先于拉闸，不会误触发 fail-closed。

## Regression Test 计划
- enforcer 计数器：单测复现"失败→成功→失败"序列后计数必须从 1 起（修前 fail）。
- watchdog：单测状态机（连续失败计数/冷却期/停手条件）。

## 哨兵（proven-to-fire 守卫）
环境接缝（真机 launchd + 真实 Tailscale）：部署后在 xian-m4 手动 kill Tailscale GUI 进程，亲眼看 watchdog 3 分钟内自动拉起并恢复 —— 报红/自愈实测一次才算 done。

## 验收标准
- [ ] failing test 先 commit（commit-1），修复代码变绿（commit-2）
- [ ] watchdog 部署 xian-m4/xian-m1，launchd 加载成功
- [ ] proven-to-fire：真机 kill Tailscale 实测自愈一次
- [ ] CI 全绿
