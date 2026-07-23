# Codex 启动前美国出口守卫设计

## 背景

西安 CMG（`mac-mini-m4-xian`，Tailscale `100.86.57.69`）当前没有启用 exit node，公网出口实测为西安电信 `CN`。Codex 的 token 能从美国 M4 拉到本地，但 `codex_apps` 随后访问 `https://chatgpt.com/backend-api/ps/mcp` 时超时，因此表面上像“token 拉取失败”，实际是 Codex 启动前没有验证执行机的公网出口。

现场还发现 `/etc/hosts` 存在 `127.0.0.1 chatgpt.com`。即使切换美国 exit node，这条本地覆盖仍会阻断 ChatGPT；出口守卫必须把它作为独立故障报告，部署时一次性人工清理，不能在日常脚本中静默修改系统文件。

## 目标

任何 team1~5 token 在西安侧被拉取或用于启动 Codex 前，先确保执行机正在使用允许的美国 Tailscale exit node，并验证实际公网出口与 ChatGPT 网络可达性。验证失败时 fail closed：不传输 token、不启动 Codex。

允许的美国出口按优先级固定为：

| 优先级 | 设备 | Tailscale 标识 | Tailscale IP |
|---|---|---|---|
| 1 | 美国 M4 | `perfect21` / `mac-mini-m4-us` | `100.71.151.105` |
| 2 | 美国 SF VPS | `sf-vps` / `vps-us` | `100.79.41.61` |

`mac-mini-m1-us` 当前没有广播 exit node，不进入允许名单。

## 方案选择

采用“自动切换、严格验证、会话结束恢复”的方案：

- 只检测后报错虽然安全，但每次需要人工切换，无法满足一条命令启动。
- 自动切换且永久保留会影响 CMG 上其他长期流量。
- 自动切换并在 Codex 退出后恢复原设置，既保证 Codex 全会话走美国，也把整机路由影响限制在使用期内。

## 组件边界

新增 `scripts/codex-us-exit-guard.sh`，集中负责以下行为：

1. 读取当前 Tailscale exit node 和候选节点在线/广播状态。
2. 保存进入前的 exit node 设置。
3. 当前出口不在允许名单时，先尝试美国 M4，失败后尝试 SF VPS。
4. 切换后验证 Tailscale 配置、实际公网国家码、DNS/hosts 与 HTTPS 连通性。
5. Codex 会话退出时，仅在守卫确实修改过路由时恢复原设置。

`codex-request.sh` 和 `codex-remote-launch.sh` 只负责编排，不各自复制出口判定逻辑。

## 验证规则

出口守卫必须依次通过以下门禁：

1. `tailscale status --json` 显示当前 exit node 是 `100.71.151.105` 或 `100.79.41.61`，且节点在线并广播 exit node。
2. 通过 Cloudflare trace 获取的公网国家码为 `US`。请求超时、响应无法解析或国家码不是 `US` 都算失败。
3. 系统解析出的 `chatgpt.com` 不能包含 IPv4/IPv6 回环地址；若 `/etc/hosts` 含对应回环覆盖，错误信息必须明确指出文件和命中行。
4. 对 `https://chatgpt.com/backend-api/ps/mcp` 发起不携带 token 的限时探测。任意非 `000` HTTP 状态均表示 DNS、TCP、TLS 和 HTTP 链路已经建立；连接、TLS 或总超时均失败。

所有探测都设短超时，不能让启动过程无限挂住。检查过程中绝不读取、发送或打印 `auth.json` 内容。

## `codex-request` 数据流

1. 解析并验证 `--team team1~5`。
2. 调用出口守卫；必要时自动切换美国出口并注册恢复动作。
3. 只有门禁全部通过后，才反向 SSH 美国 M4并拉取对应 `auth.json`。
4. 保持现有 token 剩余有效期检查和 mode 600 要求。
5. 以前台子进程运行 Codex，使守卫能在正常退出、非零退出、`Ctrl-C`/`TERM` 后恢复路由，并原样保留 Codex 的退出码。
6. 仍然不向美国回传本地 token；美国侧 crontab 保持唯一写者。

这会把当前的 `exec codex` 改为“脚本等待 Codex 子进程后恢复路由”，但不恢复已经删除的 token 回传逻辑。

## `codex-remote-launch` 数据流

`codex-remote-launch.sh` 仍是美国侧主动推送、远程创建西安 tmux 的入口，不是西安人工调用入口。西安人工使用始终执行 `codex-request --team teamN`，与当前工作目录无关。

美国侧 launcher 在传输 token 前，把出口守卫同步到西安临时路径并远程进入守卫；门禁通过后才推送 token、创建 launcher 和 tmux。远程 Codex launcher 持有恢复责任，在 Codex 退出后恢复原出口。若 token 推送或 tmux 创建在中途失败，美国侧 launcher 必须调用远程清理路径恢复出口。

## 失败与恢复语义

- 美国 M4 不在线或无法切换时，尝试 SF VPS。
- 两个节点都不可用时，退出非零，并列出两个候选的检测结果。
- 公网仍为 `CN`、`chatgpt.com` 命中回环、HTTPS 不可达时，立即停止，不拉/推 token。
- 守卫只恢复自己修改过的设置；启动时已经使用允许的美国节点，则保持不变。
- 恢复失败必须打印高可见错误。如果 Codex 本身成功而恢复失败，整体返回非零；如果 Codex 已非零，则保留 Codex 退出码并同时报告恢复失败。
- 不自动编辑 `/etc/hosts`、Tailscale 管理策略或系统 DNS。

本版本按现有人工单会话使用模型设计，不新增跨多个并发 Codex 会话的全局路由租约管理。若未来同一台 CMG 并发运行多个交互会话，需另行增加引用计数/租约，避免一个会话先退出后恢复路由影响另一个会话。

## 测试策略

遵循 TDD，在现有 shell mock 测试模式上新增守卫测试，并扩充两个入口测试：

- 当前已是美国 M4：不切换、不恢复，门禁通过后才传输 token。
- 当前已是 SF VPS：同样直接通过。
- 当前无 exit node 或为香港/中国出口：优先切美国 M4，Codex 退出后恢复原设置。
- 美国 M4 切换失败：回退 SF VPS。
- 公网国家码为 `CN`、Cloudflare 超时、hosts 命中回环、ChatGPT TLS/HTTP 探测失败：均非零退出，且 mock 日志证明没有调用 `scp` 或 Codex。
- Codex 正常退出、非零退出和信号中断：都尝试恢复；Codex 非零退出码保持不变。
- `codex-remote-launch` 的远端准备失败时不推 token；后续步骤失败时执行远端恢复。
- 保持既有 12 个 `codex-request` 测试和 9 个 `codex-remote-launch` 测试全部通过。

验收命令至少包括：

```bash
bash -n scripts/codex-us-exit-guard.sh
bash -n scripts/codex-request.sh
bash -n scripts/codex-remote-launch.sh
bash scripts/__tests__/codex-us-exit-guard.test.sh
bash scripts/__tests__/codex-request.test.sh
bash scripts/__tests__/codex-remote-launch.test.sh
```

## 部署与实机验收

1. 在 CMG 上备份 `/etc/hosts`，定点删除 `127.0.0.1 chatgpt.com`，刷新系统 DNS 缓存；该步骤需单独留痕，不由守卫脚本自动完成。
2. 将合并后的 `codex-request.sh` 与出口守卫同步到 `~/repos/cecelia/scripts/`，确认 `codex-request` alias 仍指向该入口。
3. 从“无 exit node”状态运行一次 team1，确认先切 `perfect21`、公网为 `US`，然后才拉 token 和启动 Codex。
4. 退出 Codex，确认恢复进入前的 exit node 设置。
5. 模拟美国 M4 不可用，确认切换 `sf-vps`；恢复美国 M4 后撤销模拟。
6. 验收期间不输出 token 内容，不在西安执行 `codex login`。

## 范围外

- 不改变美国侧 token 自动刷新、48 小时借用门槛或单一写者模型。
- 不让 `mac-mini-m1-us` 在未广播 exit node 时进入允许名单。
- 不自动修改 `/etc/hosts`、DNS 或 Tailscale ACL。
- 不把出口国家判断简化为设备名称字符串匹配。
- 不新增长期常驻 daemon。
