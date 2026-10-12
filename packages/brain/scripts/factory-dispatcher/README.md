# 技能工厂派发器（factory-dispatcher）

在 MMV（本机 macOS）常驻，把 Brain 里 `task_type=skill_factory_run`（独立类型，任务 0a70684f；迁移窗口内兼容旧借壳
`research`）且 `payload.factory_dispatch=true` 的 queued 任务，
代领设备锁后派给 OpenClaw 的 `skill-factory` agent 真机执行，并守望到终态。
us-vps 零执行铁律：linux / 容器内启动自检直接拒绝运行（退出码 78）。

## 任务契约

```json
{
  "factory_dispatch": true,
  "factory": {
    "stage": "3",
    "workflow_key": "douyin-collect",
    "device": { "node": "xian-m4", "profile": "jinnuo", "serial": "XXXX", "ssh_host": "xian-m4" },
    "agent": "skill-factory",
    "skill": "android-douyin-bgm-collect",
    "round": 1,
    "run_prefix": "sf3",
    "message": "可选补充说明"
  }
}
```

- 可选字段默认值：`device.ssh_host=xian-m4`、`round=1`、`run_prefix=sf<stage>`、`message` 为空。
- `stage` / `device.profile` / `device.ssh_host` / `run_prefix` 只允许 `[A-Za-z0-9._-]` 且首字符为字母数字（防 ssh 注入）。
- `agent` 必须是 `skill-factory`；`round` 必须是正整数。契约不合规：claim 后直接落 failed（`invalid_contract: ...`）。
- `run_id = <run_prefix>-<任务id前8位>-<上海yyyymmdd>-r<round>`；会话 id = `sf-<stage>-<任务id前8位>`。

## 流程

1. 上海时间 09:00–23:00 之外不认领。
2. 筛 queued、`task_type=skill_factory_run`（或旧 `research`）且 `factory_dispatch=true` → `POST /tasks/:id/claim`（executor_kind=openclaw-agent；409 跳过）→ `PATCH in_progress`。
3. 等锁：`ssh <host> 'export PATH=$HOME/.local/bin:$PATH; douyin-phone-adb --profile <p> lock-status'`；
   free 时 `lock-acquire <run_id>` 并校验回执 `lock=acquired owner=<run_id>`；他人占用（含 stale）只等不接管，
   每轮 PATCH in_progress；等超时（默认 30 分钟）落 failed，不释放任何锁。
4. 消息文件 Buffer utf8 写入 + `TextDecoder(fatal)` 读回逐字节校验，消息含 run_id、Brain 任务 id、锁纪律、交付要求。
5. `LANG/LC_ALL=en_US.UTF-8` 启动 `openclaw agent --agent skill-factory --session-id <id> --thinking high --timeout 3000 --json --message-file <f>`。
6. 守望（每 30 秒）：任务 failed/completed 即终态不再改；被打回 queued 就 PATCH 回 in_progress；
   日志出现 `"ok": false`、超时（默认 60 分钟）、会话退出后宽限期（3 分钟）仍无终态 → 杀会话、
   确认锁 owner 是自己的 run_id 再 `lock-release` 并回读 free，落 failed 写 `result.fail_reason`。
7. 会话自己终态后若锁仍是自己的，由派发器释放。
8. 会话期间每 10 分钟对仍属自己的锁 `lock-refresh`（锁 TTL 1800 秒，防长会话中途被当 stale 回收）。

运行文件：`~/.factory-dispatcher/runs/<run_id>.msg.txt`（消息）、`<run_id>.agent.log`（会话输出）。
派发器日志：`~/Library/Logs/factory-dispatcher.log`。

Commander 改线后以 `FACTORY_DISPATCHER_MODE=verify-only` 运行：只消费独立类型、完整来源关系的 run-verify 核验单；轮询及直接派发均拦旧执行，claim 前读回核验契约。模式未设置默认 `all` 兼容旧部署，未知模式拒启动。

可调环境变量：`FACTORY_DISPATCHER_MODE`、`BRAIN_URL`（默认 `http://localhost:5221`）、`FACTORY_DISPATCHER_STATE_DIR`、`OPENCLAW_BIN`、
`FACTORY_LOCK_WAIT_MIN`（默认 30）、`FACTORY_SESSION_TIMEOUT_MIN`（默认 60）。

## 安装（MMV，用户级 LaunchAgent）

从 origin/main 取脚本装到稳定位置（不依赖任何 worktree / 主仓工作区状态）：

```bash
REPO=/Users/administrator/perfect21/cecelia
SRC=packages/brain/scripts/factory-dispatcher
PLIST=~/Library/LaunchAgents/com.perfect21.factory-dispatcher.plist
git -C "$REPO" fetch origin main
mkdir -p ~/.factory-dispatcher/bin ~/Library/Logs ~/Library/LaunchAgents
git -C "$REPO" show "origin/main:$SRC/factory-dispatcher-config.js" > ~/.factory-dispatcher/bin/factory-dispatcher-config.js
git -C "$REPO" show "origin/main:$SRC/factory-dispatcher.js" > ~/.factory-dispatcher/bin/factory-dispatcher.js
git -C "$REPO" show "origin/main:$SRC/com.perfect21.factory-dispatcher.plist.template" \
  | sed -e "s#@@NODE@@#$(command -v node)#" \
        -e "s#@@SCRIPT@@#$HOME/.factory-dispatcher/bin/factory-dispatcher.js#" \
        -e "s#@@HOME@@#$HOME#g" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootstrap gui/$(id -u) "$PLIST"
launchctl kickstart -k gui/$(id -u)/com.perfect21.factory-dispatcher
tail -f ~/Library/Logs/factory-dispatcher.log
```

前提：Node ≥ 18；`openclaw` 在 `/opt/homebrew/bin`；本用户能免密 `ssh xian-m4`；
LaunchAgent 需要该用户 GUI 会话已登录。

升级：停进程后重跑上面两个 JS 文件的 `git show`（先配置模块、后主入口），再 `launchctl kickstart -k gui/$(id -u)/com.perfect21.factory-dispatcher`。

卸载：`launchctl bootout gui/$(id -u)/com.perfect21.factory-dispatcher && rm "$PLIST"`。

## 本期不做

- 崩溃恢复：派发器重启后不接回自己 claim 的 in_progress 任务，也不清理残留锁（重启前若有会话在跑需人工核对锁）。
- 按设备并发：一次只派一个任务，串行执行。
