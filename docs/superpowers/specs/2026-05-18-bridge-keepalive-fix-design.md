# Bridge Keepalive Fix — 设计文档

**日期**：2026-05-18  
**分支**：cp-0518180104-bridge-keepalive-fix  
**Goal**：修复两个系统稳定性问题：(1) brain-keepalive 的 SILENCED 永久静默 bug；(2) cecelia-bridge 缺少主动 keepalive 监控机制。

---

## 问题一：brain-keepalive-check.sh SILENCED bug

### 根因

`scripts/ops/brain-keepalive-check.sh` 存在两处静默缺陷：

**缺陷 A（第 28-33 行）**：docker daemon 不可用时，与"重启失败"走同一个 STATE_FILE（`/tmp/brain-keepalive.alerting`）。一旦 touch，后续所有 cron 运行都进入 SILENCED 分支——即便 docker daemon 已恢复，Brain 仍然停着，系统永远不再尝试重启。

**缺陷 B（第 45-47 行）**：SILENCED 分支没有任何超时、重试或升级逻辑。Brain 持续宕机期间，告警完全静默（实测产生 156+ 条 SILENCED 日志，无一条有效告警）。

### 修复设计

**改动 1：daemon 不可用路径隔离**

用独立的 `DAEMON_STATE_FILE=/tmp/brain-keepalive-daemon.alerting`，TTL 10 分钟。
- `docker info` 失败时：check DAEMON_STATE_FILE mtime。若超过 600s 或不存在 → 发飞书告警 + touch DAEMON_STATE_FILE。否则静默（避免每分钟重复告警）。
- 不触碰主 `STATE_FILE`，这样 docker daemon 恢复后下次 cron 会正常执行重启流程。

**改动 2：SILENCED 路径加 TTL**

STATE_FILE 存在时，检查 mtime。若超过 300s（5 分钟）→ 删除 STATE_FILE，重新进入重启流程。这保证系统每 5 分钟自动重试一次，而不是永久静默。

**改动后完整流程**：

```
Brain 未运行？
  └─ daemon 不可用？
       └─ DAEMON_STATE_FILE 不存在 或 >600s → 发告警 + touch DAEMON_STATE_FILE
       └─ DAEMON_STATE_FILE <600s → 静默（不触碰 STATE_FILE）
  └─ daemon 可用
       └─ STATE_FILE 不存在 或 >300s → 删除 STATE_FILE → 尝试重启
            ├─ 重启成功 → 发 ✅ + 不写 STATE_FILE
            └─ 重启失败 → 发 P0 + touch STATE_FILE
       └─ STATE_FILE 存在且 <300s → SILENCED（正常的短暂冷却期）
Brain 运行中？
  └─ STATE_FILE 存在 → RECOVERED + rm STATE_FILE + 发 ✅
  └─ DAEMON_STATE_FILE 存在 → rm DAEMON_STATE_FILE（daemon 已恢复）
  └─ 正常 → log OK
```

---

## 问题二：cecelia-bridge 缺少主动 keepalive

### 根因

`com.cecelia.bridge.plist` 的 `KeepAlive: true` 是被动机制：仅在进程退出后重启，有 launchd throttle（连续崩溃指数退避）。无告警、无可见性。实测 bridge 停了 3 天，所有 `harness_initiative` 任务在 dispatcher 层以 `no_executor` 回滚，系统无任何告警。

### 修复设计

**新文件 1：`scripts/ops/bridge-keepalive-check.sh`**

镜像 brain-keepalive-check.sh 模式，主动健康巡检：

```
bridge 健康（curl localhost:3457/health 3s超时）？
  └─ 不健康
       └─ STATE_FILE 不存在 或 >300s → 删除 STATE_FILE → 尝试重启
            ├─ 先试 launchctl kickstart gui/501/com.cecelia.bridge
            └─ wait 5s → 复查
                 ├─ 健康 → 发 ✅ + 不写 STATE_FILE
                 └─ 还不健康 → fallback：nohup node .../cecelia-bridge.cjs >> logs/bridge.log 2>&1 &
                      └─ wait 5s → 复查
                           ├─ 健康 → 发 ✅ + 不写 STATE_FILE
                           └─ 还不健康 → 发 P0 + touch STATE_FILE
       └─ STATE_FILE 存在且 <300s → SILENCED
  └─ 健康
       └─ STATE_FILE 存在 → RECOVERED + rm STATE_FILE + 发 ✅
       └─ 正常 → log OK
```

关键参数：
- STATE_FILE: `/tmp/bridge-keepalive.alerting`
- 健康检查 URL: `http://localhost:3457/health`
- 健康检查超时: 3s
- SILENCED TTL: 300s（5 分钟，与 brain-keepalive 一致）
- 飞书告警：复用 `$FEISHU_BOT_WEBHOOK`（与 brain-keepalive 同一 webhook）
- REPO_ROOT: `$(cd "$(dirname "$0")/../.." && pwd)`
- bridge 脚本路径: `$REPO_ROOT/packages/brain/scripts/cecelia-bridge.cjs`

**新文件 2：`scripts/ops/com.cecelia.bridge-keepalive.plist`**

```xml
Label: com.cecelia.bridge-keepalive
StartInterval: 60
ProgramArguments: [bash, scripts/ops/bridge-keepalive-check.sh]
EnvironmentVariables: FEISHU_BOT_WEBHOOK (从 plist 传入)
StandardOutPath: cecelia/logs/bridge-keepalive.log
StandardErrorPath: cecelia/logs/bridge-keepalive-error.log
RunAtLoad: true
```

安装命令（deploy 步骤）：
```bash
cp scripts/ops/com.cecelia.bridge-keepalive.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cecelia.bridge-keepalive.plist
```

---

## 测试策略

### E2E smoke test（真环境验证）

新文件：`packages/brain/scripts/smoke/bridge-keepalive-smoke.sh`

验证项：
1. `[ARTIFACT]` `scripts/ops/bridge-keepalive-check.sh` 存在且可执行
2. `[ARTIFACT]` `scripts/ops/com.cecelia.bridge-keepalive.plist` 存在
3. `[ARTIFACT]` `~/Library/LaunchAgents/com.cecelia.bridge-keepalive.plist` 已安装（部署后）
4. `[BEHAVIOR]` bridge-keepalive-check.sh 语法正确（`bash -n` 检查）
5. `[BEHAVIOR]` brain-keepalive-check.sh 修复后：DAEMON_STATE_FILE 路径不同于 STATE_FILE
6. `[BEHAVIOR]` brain-keepalive-check.sh 修复后：SILENCED 分支包含 mtime 检查逻辑

### Unit test

`packages/brain/scripts/smoke/bridge-keepalive-smoke.sh` 内验证脚本逻辑（bash -n syntax check + grep 关键变量）。

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 修改 | `scripts/ops/brain-keepalive-check.sh` |
| 新增 | `scripts/ops/bridge-keepalive-check.sh` |
| 新增 | `scripts/ops/com.cecelia.bridge-keepalive.plist` |
| 新增 | `packages/brain/scripts/smoke/bridge-keepalive-smoke.sh` |

不触碰 Brain 核心代码（`packages/brain/src/`），无 DB migration，无 API 变更，风险低。
