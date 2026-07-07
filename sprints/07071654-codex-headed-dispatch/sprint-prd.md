# Sprint PRD: codex 有头 tmux 派发（最小验证片，Sprint 1/3）

task_id: 4cedf175-3b56-4d41-91b6-73de559f58c9
sprint_dir: sprints/07071654-codex-headed-dispatch
base_repo: https://github.com/perfectuser21/cecelia.git

---

## Invariant 约束

1. **不改默认值**：本 sprint 不改 codex 缺省模式（默认仍走无头 docker），Sprint 2 才切默认。
2. **禁止 `$(cat)` 内联**：prompt 必须经宿主文件中转或参数文件方式交付，严禁在 tmux/ssh 命令串内用 `$(cat file)` 内联多层引号。
3. **ssh 失败 fail-open**：watchdog 检测 tmux 存活时，ssh 命令本身失败（网络/权限）必须 fail-open 跳过，不触发重点火。
4. **收窗幂等**：已标记 done/failed 的 run 不重复触发 kill-session，通过终态标记机制保证。
5. **headed 仅限 executor=codex**：`executor=claude + mode=headed` → 400 拒绝，不进队列。
6. **不引入账号池**：本 sprint 沿用 CODEX_RELAY_HOME 单账号，不建池，不改 pool 逻辑。

---

## 累积 FR（Functional Requirements）

### FR-01：headed 分支校验入队
- `POST /api/brain/tasks` 携带 `executor=codex, mode=headed` → 正常入队。
- `executor=claude, mode=headed` → 400 返回错误。
- `mode` 缺省 / `headless` → 走现有 docker 路径零回归。

### FR-02：spawnSkillRelaySession 有头路径
- `mode=headed` 时不起 docker 容器、不产生 extraMounts。
- 通过 host-executor.js 已验证 ssh 逃逸链路，连宿主机。
- prompt 写入宿主 `/tmp/cecelia-host-prompts/<taskid>.<instance>.prompt`（chmod 0600）。
- 起 `tmux new-session -d -s codex-relay-<short> -c <worktree_host_path>`，在 session 内运行 codex TUI，prompt 用文件重定向/参数文件方式交付。
- env 注入 `CODEX_HOME=$HOME/.codex-team2`，不注入 GITHUB_TOKEN（宿主 gh 已登录）。
- `tmux pipe-pane -o` 留痕到 `<sprint_dir>/tui.log`，写入前管道洗敏（过滤 `gh[ps]_/github_pat_` 正则）。
- initiative_runs 落库：`orchestrator_host='skill-relay-codex-headed'`，deadline=8h。

### FR-03：看门狗 headed 分支
- 存活检测：`ssh 宿主 tmux has-session -t codex-relay-<short>`。
- ssh 命令本身失败 → fail-open，保守跳过，不触发重点火。
- session 消失 + run 未 done + PR 未 MERGED → 走现有重点火/attempts=2/收尸链。

### FR-04：收窗幂等终态标记
- run 终态（done/failed）后保留窗口 30min 供围观残留，然后 kill-session。
- 新增 `tmux_killed_at` 列（或等价方案），已收过的 run 不再重复 ssh kill。

### FR-05：dry-run 验收
- dry-run（echo 型短 prompt）派出后，`ssh 宿主 tmux has-session -t codex-relay-<short>` 返回 exit 0。
- 宿主 prompt 文件存在且 sha256 与发送内容匹配。
- initiative_runs 行 `orchestrator_host='skill-relay-codex-headed'` 写入正确。

---

## NFR

- **单测覆盖**（vitest，deps 注入 spawnFn/execFn mock）：
  1. mode=headed → ssh+tmux 路径，无 docker extraMounts。
  2. mode 缺省/headless → docker 路径零回归。
  3. claude+headed → 400。
  4. watchdog headed：tmux has-session 失败（ssh 出错）→ fail-open 不重点火。
  5. 收窗幂等：已收终态 run 不再触发 kill。
- **CI 全绿**，feat PR 含 `*.test.js`，DevGate 三连过。
- **无密钥硬编码**：tui.log 洗敏 pattern 与 entrypoint 同逻辑。
- **行为不扰默认**：现有无头 codex/claude relay 回归测试全通。

---

journey_type: harness_pipeline
target_environment: local_api
