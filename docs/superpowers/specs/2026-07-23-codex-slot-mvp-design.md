# Codex Slot MVP 设计

## 背景

当前美国 M4 使用 `~/.codex-team1` 至 `~/.codex-team5` 保存公司 Codex 账号，并由美国侧 crontab 作为唯一 token 写者。西安 M4 通过 `codex-request --team teamN` 手工选择账号、拉取 `auth.json` 后启动 Codex。美国 M4 上还存在 `slot1` 至 `slot10` 的 tmux 会话，但数字 slot 同时承担了容量编号和用户工作会话两个概念，无法表达使用者、项目、主机和账号租约。

现场实际边界是：

- 美国 M4 只由 Alex 直接 SSH，既是 Alex 的私有交互机，也是公司 Codex token 的控制面。
- `xian-m4` 与 `xian-m1` 将成为共享双活执行节点，供 Alex、同事和 Cecelia 自动化使用。
- 人员通过自己的电脑使用 SSH/VSCode 进入西安节点；自动化使用独立服务身份。
- 公司 team1 至 team5 不归个人所有，应由系统按会话临时分配。

`codex-slot` 此前只是目标交互设计，尚未实现。本设计定义可落地的第一版。

## 目标

提供统一的 `codex-slot` 命令，使用户不再记忆 `slot1` 至 `slot10`、目标主机或 team 账号：

```bash
codex-slot start
codex-slot list
codex-slot resume
codex-slot attach <handle>
codex-slot stop <handle>
```

系统根据已认证的 SSH 身份识别 actor，自动选择执行主机和空闲公司账号，为会话创建隔离的 tmux、worktree、日志与 `CODEX_HOME`，并允许用户通过稳定的项目会话名称恢复。

## 分阶段范围

### MVP

第一版完成以下闭环：

1. 在客户端安装 `codex-slot`，允许 Alex 从自己的电脑直接运行。
2. 在美国 M4 部署账号租约 broker；token 源仍由现有 crontab 唯一写入。
3. 在西安 M4 部署执行 agent，支持会话创建、列出、恢复、附着和停止。
4. 用中央 registry 记录跨主机 session 与账号 lease。
5. 导入现有 `slot1` 至 `slot10` 为只读 legacy 会话，不自动删除。
6. 为西安 M1 保留同一 agent 和主机注册接口，但在磁盘恢复安全水位前不开放新 slot。

### 后续

- 为同事建立独立西安系统用户和 SSH key。
- 为 Cecelia 建立无普通交互 shell 的服务身份。
- 西安 M1 完成磁盘治理、运行栈安装后加入自动调度。
- VSCode 一键打开 registry 所定位的主机与 worktree。
- 有状态服务的主从或外置状态库不与本 MVP 混在一起实施。

## 身份模型

身份由服务端观察到的 SSH 登录身份确定，客户端传入的 `--actor` 不作为授权依据。

| Actor | 美国 M4 | xian-m4 / xian-m1 | 用途 |
|---|---|---|---|
| `alex` | 普通 SSH + broker 管理 | 独立个人用户 | SSH、VSCode、交互 Codex |
| `coworker` | 无普通 shell；后续仅允许 broker forced-command | 独立个人用户 | SSH、VSCode、交互 Codex |
| `cecelia` | 无普通 shell；仅允许 broker forced-command | 独立服务用户 | 自动化任务 |

每台客户端设备使用独立 SSH key。key fingerprint 与设备标签只用于审计和撤销；人员身份来自 key 最终登录到的服务端系统用户。因此 Alex 更换电脑不会丢失 session，同一台电脑也不能通过伪造设备名变成其他 actor。

## 三层资源模型

### 1. Actor

表示谁发起任务：Alex、同事或 Cecelia。Actor 拥有自己的 home、tmux namespace、worktree 根目录、日志和 Codex session 历史。

### 2. Session

表示可恢复的用户工作上下文，使用稳定 handle：

```text
alex/infrastructure/main
alex/cecelia/disk-guard
coworker/video-generation/main
cecelia/task/42318
```

Session 记录：

- actor
- project 与用户可读名称
- home host
- worktree 路径与 git branch
- tmux session 名称
- Codex session home
- 状态、PID、创建时间和最后心跳
- 当前账号 lease ID

运行中的 session 固定 home host，避免未提交 worktree 被静默迁移。主机故障时，只有已提交并推送的 clean worktree 可以在另一节点重建；否则保持 unavailable 并报告原主机，不做有损迁移。

### 3. Physical Slot

表示主机瞬时并发容量，例如 `xian-m4/3`。数字 slot 只在调度器和监控中出现，不作为用户恢复入口。释放后同一个 physical slot 可以被另一 actor 或自动化复用。

## 公司账号租约

team1 至 team5 是公司共享账号池，不固定归属个人。

美国 M4 broker 使用原子目录锁为每个 team 创建唯一 lease。macOS 默认没有可靠的 `flock`，因此使用同文件系统上的 `mkdir` 作为原子互斥原语。每个 lease 至少记录：

```json
{
  "lease_id": "lease-...",
  "team": "team3",
  "actor": "alex",
  "session": "alex/infrastructure/main",
  "host": "xian-m4",
  "created_at": "...",
  "heartbeat_at": "...",
  "state": "active"
}
```

规则：

1. 同一个 team 同时最多一个活跃 lease。
2. actor 不能手工指定 team；broker 从未租用且 token 新鲜的账号中选择。
3. 选择时优先使用额度较充足的账号；额度查询失败的账号不发放。
4. 人工交互与自动化进入同一租约表。后续接入 Cecelia 时至少为人工保留两个可用账号容量。
5. lease 心跳超时不能直接重分配。broker 必须向记录的执行主机核验 tmux/PID 已死亡；主机不可达时将 lease 标成 quarantined，避免同账号并发使用。
6. 美国 M4 上 Alex 的本地 Codex session 也登记 lease，防止与西安 session 撞同一 team。

## Token 与 CODEX_HOME

美国 M4 的 `~/.codex-teamN/auth.json` 是 token 源，禁止交互式 Codex 直接以该目录作为可写 `CODEX_HOME`。

每个 session 使用独立目录：

```text
~/.codex-slots/<actor>/<session-id>/codex-home/
```

其中：

- `sessions/`、`history.jsonl` 和用户配置随 session 持久保留。
- `auth.json` 来自当前 lease 的只读快照，mode 固定为 `600`。
- session 停止时删除 `auth.json` 并释放 lease，但保留历史与 worktree。
- resume 时可以租到不同 team，再注入新的 `auth.json`，用户不需要记住上次账号。
- 西安永不执行 `codex login`，也不向美国回传 token。
- stdout、日志、registry 与错误信息均不得包含 token 内容。

美国侧现有 team2 `auth.json` mode 为 `644`，部署前必须统一修复为 `600`。

## CLI 行为

### `codex-slot start`

默认从当前目录 basename 推导 project。也支持：

```bash
codex-slot start --project infrastructure --name main
codex-slot start --project cecelia --name disk-guard
```

流程：

1. 客户端通过 SSH 连接 broker，broker 从认证身份得到 actor。
2. registry 检查同 actor、project、name 是否已存在；存在时拒绝重复创建并提示 `resume`。
3. host allocator 从健康执行节点中选择有容量的主机。
4. broker 原子申请公司账号 lease。
5. agent 创建 session 目录、git worktree、tmux launcher 与私有 `CODEX_HOME`。
6. token 快照直接从美国 M4传到目标 slot，mode 设为 `600`。
7. agent 启动 Codex 并开始心跳。
8. CLI 返回稳定 handle、host 和附着命令，并默认进入交互会话。

任一步失败都按逆序回滚已创建资源并释放 lease。无法确认进程已停止时 lease 进入 quarantined，不回到可分配池。

### `codex-slot list`

默认仅列出当前 actor 的 session，跨 xian-m4 与 xian-m1 汇总：

```text
HANDLE                     HOST       STATUS    LAST_ACTIVE
alex/infrastructure/main   xian-m4    running   2m
alex/cecelia/disk-guard    xian-m1    stopped   1d
```

普通用户不能查看其他 actor 的路径、日志或账号信息。管理员可使用显式审计模式查看全局状态。

### `codex-slot resume`

- 提供 handle 时恢复指定 session。
- 不提供 handle 时，根据当前目录 project 选择该 actor 最近使用的 session。
- running session 直接 attach。
- stopped session 重新申请账号 lease、注入 auth 并在原 home host 启动。
- session 位于另一台主机时自动 SSH 跳转，用户不需要记住主机。

### `codex-slot attach`

只附着 running session，不创建新 lease。目标位于另一台主机时通过 SSH `-t` 跳转。

### `codex-slot stop`

停止 Codex/tmux、清除临时 auth、释放账号 lease，但保留 worktree、历史和 session handle。重复执行结果一致。

## 现有 slot1 至 slot10 的迁移

部署时只读扫描现有 tmux 会话，登记为：

```text
legacy/us-m4/slot1
...
legacy/us-m4/slot10
```

迁移规则：

- 不自动 kill、重命名或删除任何现有 slot。
- 保留原 tmux 名称和工作目录。
- `codex-slot list --legacy` 显示命令、路径、是否 attached 和最后活动时间。
- 管理员确认 owner/project 后才能执行 adopt，将 legacy session 映射为新 handle。
- 无法确认归属的 session 永远只报告，不自动清理。

因此 Alex 不需要继续记住数字 slot，但旧会话也不会因上线新系统丢失。

## 主机注册与容量

执行节点由版本化配置注册：

```text
xian-m4: enabled, interactive=true, automation=true
xian-m1: enabled=false, reason=disk_pressure
```

两台西安机器最终运行相同 agent、Codex 版本、Tailscale 出口守卫和项目目录约定，但容量可以不同。双活表示职责相同、都可被调度，不表示并发数相同。

新 session 的容量门禁使用宿主机 `/System/Volumes/Data` 和 APFS 容器真实余量。当前实测：

- xian-m1：约 2 GiB 空闲，99% 已用，禁止新 slot。
- xian-m4：约 13 GiB 空闲，94% 已用，仅允许部署和只读盘点；创建新 worktree 前必须先恢复安全容量。

磁盘采样失败或过期时 fail closed。容量治理与 M1 运行栈安装单独形成后续实施批次，不能通过降低安全阈值绕过。

## Registry 与权限

中央 registry 位于美国 M4，由 broker 单一写入。MVP 使用原子落盘 JSON：

```text
~/.codex-slot/
  registry/
    sessions/<session-id>.json
    leases/<team>.json
    hosts/<host>.json
  locks/
  audit/YYYY-MM-DD.jsonl
```

写入采用“临时文件 + fsync/close + rename”，锁使用原子 `mkdir`。所有路径固定在该根目录内，session ID、team、host 和 actor 均经过严格格式校验，禁止未校验的路径拼接。

审计日志记录 actor、SSH key fingerprint、设备标签、session、host、team、动作、时间和结果，不记录 token、prompt 内容或环境变量。

## 错误与恢复

- 无可用公司账号：不创建 tmux/worktree，返回当前租约摘要。
- token 过期或 mode 不安全：该账号隔离，选择其他账号；全部不可用则失败。
- 目标主机磁盘不足：不创建 session，尝试其他健康节点。
- token 已复制但 tmux 启动失败：删除 slot auth、删除本次新建资源并释放 lease。
- 客户端断线但 tmux 仍活：session 保持 running，用户可 `resume/attach`。
- tmux/PID 已死：reaper 清除 auth、将 session 标 stopped 并释放 lease。
- broker 或执行主机不可达：不猜测、不复用相关 lease，标 quarantined。
- stop/reaper/webhook 并发：通过 session 锁保证只有一个清理者，重复调用幂等。

## 测试与验收

测试必须使用临时目录和 mock SSH/tmux/scp，不读取真实 token：

1. SSH 登录身份映射 actor，客户端伪造 actor 无效。
2. 两个并发 acquire 对同一 team 只有一个成功。
3. start 自动选择空闲 team，不接受 `--team`。
4. token 快照 mode 为 `600`，输出中不出现 token 内容。
5. start 每一步注入失败都释放 lease 并清理本次新建资源。
6. 客户端断线时 running tmux 不被误判为 stopped。
7. 超时 lease 在远程 PID 仍活或主机不可达时进入 quarantined，不被重分配。
8. list 只显示当前 actor；管理员审计模式除外。
9. resume 无参数时按当前 project 选择最近 session。
10. resume 位于另一主机时生成正确 SSH 跳转。
11. stop 幂等，删除 auth、保留 history/worktree。
12. legacy slot 扫描只读，不 kill、不删除、不改名。
13. xian-m1 当前磁盘水位下拒绝新 session。
14. 回归现有 `codex-request`、`codex-remote-launch` 和 `dispatch-worker` 测试。

实机验收先在 xian-m4 完成，但必须先治理磁盘至安全水位：

```text
Mac 客户端 codex-slot start
  → broker 分配 team
  → xian-m4 创建隔离 session
  → Codex 可交互
  → 客户端断开后 session 仍存在
  → codex-slot resume 自动恢复
  → codex-slot stop 清除 auth 并释放 lease
```

## 范围外

- 本 MVP 不把 PostgreSQL 复制成双主库。
- 不自动删除现有 slot1 至 slot10。
- 不允许西安节点执行 `codex login`。
- 不让客户端自行决定 actor 或 team。
- 不在磁盘高压时通过降低阈值强行开放 M1/M4。
- 不在第一版实现跨主机迁移未提交 worktree。
