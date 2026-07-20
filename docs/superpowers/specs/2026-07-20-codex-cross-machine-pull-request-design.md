# Codex 跨机 token 管理 —— 西安侧 pull-request 模式设计

## 背景

PR #4132 落地了 `scripts/codex-remote-launch.sh`：美国 M4 作为 team3/4/5 的 token 管理/刷新点，主动 push token + 远程拉起 tmux 到西安 M4。这是"美国主动推"模型，服务于 headless/harness 自动化派发场景。

用户在对话中明确了另一个真实场景：同事在西安 M4 上是手工交互使用 codex 的（team1~5 全部账号都有可能被手工用到），他不想改变"只 SSH 西安一个地方"的现有习惯，也不想被拉进美国机器的访问范围。定时 push/collect（cron）方案被否决——存在新鲜度窗口问题，且需要在美国侧判断西安是否有活跃会话才能决定要不要覆盖，机制复杂。

已实测确认：西安 M4 → 美国 M4（`ssh administrator@100.71.151.105`）反向连通直接可用（Tailscale identity，无需额外配置）。这使得"西安主动发起请求，用前拉最新、用后立即还"的 pull 模型可行且更简单。

## 设计

新增 `scripts/codex-request.sh`，**运行在西安 M4**（同事 `ssh xian-m4` 后在 cecelia repo 里直接跑，同事只需 `git pull` 一次拿到脚本）：

```
用法: bash scripts/codex-request.sh --team <team1|team2|team3|team4|team5>
```

执行流程：
1. 反向 SSH 探活美国 M4（`assert_ssh`，复用 codex-remote-launch.sh 同款 BatchMode 探测逻辑）
2. `scp` 从美国拉取 `~/.codex-teamN/auth.json` → 本地写入，`chmod 600`（不打印 token 内容）
3. 注册 `trap` on EXIT：无论 codex 正常退出还是异常中断，都尝试把本地（可能已被 codex CLI 自动刷新过 access_token 的）`auth.json` scp 回美国对应路径，`chmod 600`；失败不静默吞掉，打印明确错误到 stderr
4. **不用 `exec`**，以普通前台子进程运行 `env CODEX_HOME=~/.codex-teamN <codex_bin>`——`exec` 会把脚本自身进程替换成 codex 进程，脚本进程消失后第 3 步注册的 `trap ... EXIT` 永远不会触发；普通前台调用等 codex 退出（无论退出码是什么、包括 Ctrl-C）后脚本继续运行，`exit` 时 trap 正常触发完成回传。同事仍然是在自己已有的 SSH 会话里直接交互，观感和 `exec` 一样，不需要 tmux attach

同时把 `scripts/codex-remote-launch.sh` 的 `ALLOWED_TEAMS` 从 `(team3 team4 team5)` 扩展为 `(team1 team2 team3 team4 team5)`，让"美国主动推"通道（headless 自动化用）也覆盖全部 5 个账号。

两个脚本长期并存，职责不同，写入脚本头部注释区分：

| 脚本 | 发起方 | 场景 |
|---|---|---|
| `codex-remote-launch.sh` | 美国 M4 主动推 | Brain/harness headless 自动化派发 |
| `codex-request.sh` | 西安 M4 主动拉 | 同事交互式手动使用 |

## 红线（两脚本共用）

- 西安侧绝不执行 `codex login` 或任何触发认证流程的命令
- token 内容绝不打印到 stdout/日志
- 双侧 `auth.json` 均 `chmod 600`
- 白名单账号硬编码校验（拒绝非 team1~5 的输入）

## 一致性论证

不需要额外的"锁"或"版本号"机制：pull 模型天然保证一致性——每次使用前都从美国拉最新副本，使用后立即把（可能刷新过的）副本还回去。只要同一账号不并发跑两个西安会话（现实中同事是单人操作，不构成真实并发场景），美国侧看到的始终是"最近一次使用后的状态"。

## 测试策略

- **Unit（trivial 脚本自测，仿照 `scripts/__tests__/preview-reaper.test.sh` 模式）**：`scripts/__tests__/codex-request.test.sh` + 扩充 `scripts/__tests__/codex-remote-launch.test.sh`（如原 PR 无测试文件则新建），用 mock `ssh`/`scp`/`codex` 二进制覆盖 PATH，断言：
  - 非法 team 参数被拒绝（team6、空值等）
  - 正常流程按序调用 scp 拉取 → chmod 600 → 前台跑 codex（非 exec）→ trap 内 scp 推回
  - trap 在 codex 异常退出（非 0）时依然触发回传（验证 `exec` 未被使用，否则 trap 不会触发）
  - grep 断言脚本源码不含打印 token 内容的语句（`cat.*auth.json`、`echo.*auth`等）
- **集成验证（不进 CI，本任务人工核验一次即可，属于跨真实机器的操作）**：真实在西安 M4 上跑一次 `codex-request.sh --team team3`（或 team1/team2 中一个此前没验证过的账号），确认：
  1. `ssh xian-m4 'ps aux | grep codex'` 能看到进程真实起来
  2. 模拟退出（如直接 `exit` 或 Ctrl-C 触发的 trap）后，比对美国本机 `~/.codex-teamN/auth.json` 的 mtime 确实被更新
- **CI 语法门槛**：两脚本均需 `bash -n` 通过（复用仓库已有的 shell 脚本 CI 检查，如无专属 workflow 则作为 PR 验收清单的手工检查项）

## 范围外（本次不做）

- 不做定时 cron 同步（已被用户否决）
- 不做美国侧"检测西安是否有活跃会话再决定要不要覆盖"的复杂协调机制（pull 模型天然不需要）
- 不改 `push_token`/`start_remote_session` 等 `codex-remote-launch.sh` 现有函数的行为，只扩展白名单
