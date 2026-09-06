# Bug PrepPRD：tailscale-watchdog 完全失效，node key 过期后 slot1-10 全断

## 症状
2026-09-06 起 slot1~slot10 全部无响应。tmux 会话和其中的 claude 进程都存活，但客户端连不上。

## 根因（已确证）
1. 直接原因：tailscaled node key 于 04:42:22 到期 → Running -> NeedsLogin → 掉出 tailnet。
   所有 mosh-server 绑在 100.71.151.105（Tailscale IP），tailnet 断后客户端 UDP 不可达。
2. 兜底失效：com.cecelia.tailscale-watchdog 两层皆错
   - 检测对象错：pgrep -x "Tailscale" || open -a Tailscale 找 GUI App，本机跑 brew tailscaled，
     /Applications/Tailscale.app 不存在 → 每 60 秒 exit 1，长期无效
   - 检测维度错：只看进程存活。本次 tailscaled 存活 7 天，故障在认证状态，
     进程存活检查原理上抓不到

## 修法
新建 scripts/ops/tailscale-login-watchdog.py（不动 exit-node enforcer，作用域不同）：
- 读 tailscale status --json 的 BackendState，三态区分：
  Running 正常 / NeedsLogin·Stopped 重认证 / 命令失败 = 守护进程死了（重启服务）
- 需重认证时从 1Password 取 authkey 执行 tailscale up，
  只带 --hostname/--accept-dns，不带任何会重置 exit-node/routes 的 flag
- 退避冷却：失败后 1min→5min→15min→30min 封顶，避免打爆 control plane
- fcntl 锁：防并发重认证（复用 tailscale-us-exit-enforcer 模式）
- IP 漂移检测：重认证后 IP 变化要告警（mosh-server 绑旧 IP 会全断）
- authkey 临期提前 14 天预警；日志轮转

## Regression Test 计划
决策逻辑抽为纯函数 decide_action(status_json, now, state)
  → ok | reauth | restart_daemon | backoff | warn_key_expiring
可复现本 bug 的 failing test：
- 喂「进程存活 + BackendState=NeedsLogin」→ 必须 reauth
  （旧实现只看 pgrep 会判成 ok，正是 bug 本身）
- 喂 status 命令失败 → restart_daemon（不能误判为重认证）
- 喂连续失败状态 → backoff（不许每 60 秒重试）

## 守卫（环境接缝）
CI 测不到真实 tailnet。逻辑之外必须 proven-to-fire：
故意把本机打成 NeedsLogin（tailscale logout），确认 watchdog 1 分钟内自动认证回来。

## 已完成的根因消除（2026-09-06，用户操作）
Tailscale admin 已对 8 台关键机关闭 key expiry：
perfect21 / mac-mini-m4-xian / xian-m1 / node-pc-xian / rog-xian / vps-hk / vps-us / xxmba2021
→ 本次故障的直接原因（node key 到期）已永久消除。
watchdog 仍需修复，覆盖 key expiry 之外的掉线原因：
手动 logout、被管理员踢、tailscaled 崩溃、重装后未认证。

## 附带发现（另立，本次不做）
- zenithjoy-nas 已离线（末见 2026-07-30）且 key 过期 29 天，/nas 与 /nas-backup skill 当前不可用
- tailnet 存在僵尸节点 xian-m4（9/1 后离线），与活跃的 mac-mini-m4-xian 重名易混淆

## 验收标准
- [ ] failing test 先 commit（commit-1）→ 修复让其变绿（commit-2）
- [ ] proven-to-fire：真实 logout 后 watchdog 自动恢复，有日志证据
- [ ] 旧 plist 被替换，launchctl list 不再是 exit 1
- [ ] CI 全绿
