# tailscale-login-watchdog 设计

日期：2026-09-06
关联：Brain task `0a1fd513-8a1c-44c8-9492-9d6fa4b2d17a`，decision `39191825`
Sprint：`sprints/09062109-tailscale-login-watchdog/prep-prd.md`

## 背景：为什么现有 watchdog 是瞎的

2026-09-06 04:42:22，perfect21（mac-mini-m4-us）的 tailscaled node key 到期：

```
setClientStatus: netmap expiry timer triggered after 1m31.361527s
Switching ipn state Running -> NeedsLogin (WantRunning=true, nm=true)
```

节点掉出 tailnet。所有 mosh-server 绑在 Tailscale IP `100.71.151.105:60001-60010`，
客户端 UDP 再也送不到 → slot1~slot10 全部卡死无响应。

本该兜底的 `com.cecelia.tailscale-watchdog` 两层皆错：

1. **检测对象错**：`pgrep -x "Tailscale" || open -a Tailscale` 找的是 GUI App。
   本机跑 brew 版 `tailscaled`，`/Applications/Tailscale.app` 不存在
   → 每 60 秒 exit 1，长期无效（`launchctl list` 状态码即为 1）。
2. **检测维度错**：只看进程存活。本次 `tailscaled` 存活 7 天，
   故障在认证状态 —— 进程存活检查原理上抓不到。

## 支点：以 BackendState 为准，绝不看 IP

故障期间 `utun4` 上的 `100.71.151.105` 始终残留。任何"IP 还在就算健康"的检查
都会误判 —— 现有 `tailscale-us-exit-enforcer.validate_self()` 正是只看
`Self.TailscaleIPs`，它对本类故障是瞎的。

判定必须以 `tailscale status --json` 的 `BackendState` 为唯一依据。

## 判定逻辑

```
tailscale status --json
  ├── 命令失败/超时        → restart_daemon   （守护进程死了，重认证无用）
  ├── BackendState=Running → ok
  ├── NeedsLogin           → reauth
  ├── Stopped
  │     ├── prefs.WantRunning=false → ok（用户主动 tailscale down，尊重意图，仅记日志）
  │     └── 否则                    → reauth
  └── 冷却期内             → backoff          （跳过，不重试）
```

`Stopped` 必须再查 `tailscale debug prefs` 的 `WantRunning`：为 false 说明是人主动
`tailscale down`，自动 up 会对抗管理意图；本次故障是 `NeedsLogin`（WantRunning=true），
两者必须区分。

另有 `warn_key_expiring`：authkey 临期告警。**authkey 字符串本身不含到期时间**，
且查询 API 需要 Tailscale API key（1Password 内那把已于 2026-08-29 过期）。
故到期日以可选环境变量 `TAILSCALE_AUTHKEY_EXPIRES`（`YYYY-MM-DD`）提供，
写入 `~/.credentials/tailscale.env`；未提供则跳过该检查（不阻塞主逻辑）。
另在重认证失败且 stderr 命中 key 失效特征时无条件告警——这条不依赖任何配置。

## 组件

1. **状态探测**：复用 enforcer 的 `tailscale_binary()` 多候选路径探测
   （`TAILSCALE_BIN` → `shutil.which` → brew → /usr/local → App），
   正是坏 watchdog 硬编码 GUI App 踩的坑。
2. **决策纯函数** `decide_action(status, now, state)`
   → `ok | reauth | restart_daemon | backoff | warn_key_expiring`。
   无副作用，CI 完整覆盖。
3. **执行器**：`tailscale up` 只带 `--hostname` / `--accept-dns`，
   不带任何会重置 exit-node / routes 的 flag。
   （2026-09-06 手动恢复即用此法，prefs 未被破坏。）
4. **凭据**：先 `~/.credentials/tailscale.env` → miss 则 1Password（CS vault
   `Tailscale` 条目 notesPlain 的 `TAILSCALE_ONBOARD_AUTHKEY`）→ 取到后回写本地。
   当前该文件为 22 字节空壳，回写后断网亦可自救
   （符合 CLAUDE.md「1Password 唯一源 → 双写 ~/.credentials/」）。
5. **状态 / 锁**：原子写（tempfile + fsync + os.replace，0600）+ fcntl 独占锁，
   全部复用 enforcer 现成模式。

## 安全闸

`/var/db/cecelia/tailscale-login-watchdog/DISABLED` 存在时只告警、不重认证。

理由：自动重认证意味着手动 `tailscale logout` 会在 60 秒内被撤销。
安全事件中（设备丢失、疑似入侵）需要故意隔离一台机时，watchdog 不能对抗管理意图。

## 退避

失败后 1min → 5min → 15min → 30min 封顶，成功即重置。
防止重认证失败时每 60 秒打一次 control plane 触发限流（反而更难恢复）。

## IP 漂移告警

重认证后若 Tailscale IP 变化，所有 mosh-server 绑定的旧 IP 集体失效（slot 全断）。
此情况 watchdog 自身救不了（需重启 slot 会话），必须告警。

## 测试策略

E2E 档（照 `tests/regression/tailscale-us-exit/*.contract.test.js` 模式）：
fake `tailscale` 二进制经 `TAILSCALE_BIN` 注入，`spawnSync` 跑真实 Python 脚本。

必须包含可复现本次 bug 的用例：

```
喂 { BackendState: "NeedsLogin", Self: { TailscaleIPs: ["100.71.151.105"] } }
断言 → 必须调用 tailscale up
```

IP 仍在但 key 已过期 —— 正是 2026-09-06 的真实现场。旧实现在此必然失败。

其余用例：`restart_daemon`（status 失败不得误判为重认证）、
`backoff`（不许每 60 秒重试）、安全闸生效、`tailscale up` 不含破坏性 flag。

## 守卫（环境接缝）

CI 跑在干净假环境，测不到真实 tailnet。故逻辑测试之外必须 proven-to-fire：
真实 `tailscale logout` 一次，确认 watchdog 在 1 分钟内自动认证回来并留下日志证据。
未亲眼见其生效的守卫不算守卫。

## 不在本次范围

- `zenithjoy-nas` 已离线（末见 2026-07-30）且 key 过期，`/nas` 与 `/nas-backup` 当前不可用
- tailnet 僵尸节点 `xian-m4`（9/1 后离线），与活跃的 `mac-mini-m4-xian` 重名易混淆

## 已完成的根因消除（2026-09-06，用户操作）

Tailscale admin 已对 8 台关键机关闭 key expiry：
perfect21 / mac-mini-m4-xian / xian-m1 / node-pc-xian / rog-xian / vps-hk / vps-us / xxmba2021
→ 本次故障的直接原因已永久消除。

watchdog 仍需修复，覆盖 key expiry 之外的掉线原因：
手动 logout、被管理员踢下线、tailscaled 崩溃、重装后未认证。
