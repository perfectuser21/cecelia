# Tailscale 自愈 watchdog + enforcer/login-watchdog 计数器修复 — 设计

## 背景（2026-09-07 xian-m4 断网事故）
Tailscale macsys network-extension 内部卡死 27 分钟（进程活、localapi 全无响应），
tailscale-us-exit-enforcer 判定 daemon_absent 超阈值后 fail-closed 拉闸，整机断网，人工重启才恢复。
诊断中另发现：① xian-m4 部署版 enforcer（9-03/9-04 容错热修）从未回填 repo，配置漂移 115 行 diff；
② 部署版计数器跨事故残留（故障首条错误 consecutive_failures=51）；
③ login-watchdog backoff/disabled/restart_daemon 分支不清零计数、不 persist；
④ perfect21 重认证后 exit node 广播被冲掉（9-06 watchdog 测试后 ExitNodeOption=False），西安机失去 primary 出口冗余。

## 组件与改动

### 1. 回填 enforcer 部署版（配置漂移归零）
把 xian-m4 `/usr/local/libexec/cecelia/tailscale-us-exit-enforcer.py`（含 9-03 CONSECUTIVE_FAILURE_THRESHOLD=3、
9-04 DAEMON_ABSENT_FAILURE_THRESHOLD=10 双阈值容错）整体回填 `scripts/ops/tailscale-us-exit-enforcer.py`。
repo 从此是唯一真源。

### 2. enforcer 计数器过期语义（修跨事故残留）
计数文件由裸整数改为 JSON：`{"count": N, "last_failure_ts": <epoch>}`。
读取时若 `now - last_failure_ts > 300s`（5 倍 StartInterval）→ 视为过期，从 0 重计。
兼容旧格式：读到裸整数按过期处理。成功 tick 仍双清零。
效果：无论何种历史路径导致残留，都不可能把旧事故计数带进新事故。

### 3. 新增 scripts/ops/tailscale-health-watchdog.py（主刀，自愈）
- 形态：root LaunchDaemon（label com.cecelia.tailscale-health-watchdog），StartInterval=60，--once 模式。
- 探测：`tailscale status --json` 15s 超时（复用 enforcer 的 tailscale_binary()/target_command() 惯例），
  失败或 BackendState != "Running" 计一次失败。
- 状态机（state.json 原子写，含 fail_count/last_restart_ts/restart_round）：
  - 连续 3 次失败 → 一级自愈：`open -gja Tailscale`（enforcer 143-154 已验证的唤醒模式）
  - 唤醒后下一轮仍失败 → 二级自愈：`pkill -f io.tailscale.ipn.macsys.network-extension`
    （root 权限；NE framework 会自动重启 system extension——本次故障中扩展进程活着但死锁，必须强杀）
  - 冷却：600s 内最多一轮自愈；连续 3 轮自愈无效 → 停手，只 emit stuck 告警日志（防重启风暴）
  - 任一次探测成功 → 全部清零
- 时序兼容：3 分钟检测 + ~40s 恢复 < enforcer daemon_absent 拉闸阈值 10 分钟 → 自愈先于拉闸。
- 安全阀：`/var/db/cecelia/tailscale-health-watchdog/DISABLED` 存在则跳过（同 login-watchdog 惯例）。
- 安装：scripts/ops/install-tailscale-health-watchdog.sh，复用 enforcer 安装器模式
  （--check-client 前置安全闸 / install 到 /usr/local/libexec/cecelia / plistlib 生成 / bootout+bootstrap+kickstart，
  路径全部参数可覆盖以便 CI mock）。目标机：xian-m4、xian-m1。

### 4. login-watchdog 两处修复（perfect21）
- 计数器：`action in (backoff, disabled, restart_daemon)` 分支改为每 tick persist；
  其中 restart_daemon/disabled 属"非 reauth 失败"路径 → 清零 consecutive_failures
  （backoff 保留计数——它是 reauth 失败的延续）。同时把 authkey 获取失败(440)与 tailscale up 失败(450)
  的计数器语义保持现状（YAGNI，不拆双计数器）。
- exit node 广播：reauth 成功后（460 清零处）若 env `CECELIA_LOGIN_WATCHDOG_ADVERTISE_EXIT=1`，
  追加幂等 `tailscale set --advertise-exit-node`（30s 超时，失败只 emit 不阻塞）。
  安装器 plist 对 perfect21 注入该 env。不改 tailscale up 参数（docstring 明确 up 带 flag 有覆盖 prefs 风险）。

## 测试策略（regression, vitest contract test，先例 tests/regression/tailscale-login-watchdog/）
- enforcer 计数器：过期归零 / 未过期递增 / 旧裸整数兼容 / 成功双清零（修前对残留场景 fail）。
- health-watchdog 状态机：3 次判卡死 / 一级→二级升级 / 冷却期 / 3 轮停手 / DISABLED 跳过 / 成功清零。
- login-watchdog：restart_daemon 分支清零并 persist（修前 fail）；advertise env 开关行为。
- 均为纯逻辑测试（subprocess/文件系统注入 mock），进 CI 永久跑。

## 哨兵（proven-to-fire）
环境接缝（真机 launchd + 真实 Tailscale）：部署 xian-m4 后手动 `pkill` Tailscale GUI 或挡住 localapi，
亲眼看 watchdog ≤4 分钟自动恢复并在日志 emit restart 事件——实测一次才算 done。

## 不做（YAGNI）
- 不给 perfect21（brew tailscaled 变体）装 health-watchdog——它已有 login-watchdog，且本次故障形态（macsys 扩展死锁）不适用 brew 变体。
- 不实现 login-watchdog 的 restart_daemon 真实重启（另立任务）。
- 不动 enforcer 的 fail-closed 设计本身（合规要求保留）。
