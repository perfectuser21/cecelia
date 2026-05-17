# Stop Hook v23 重构设计文档

> 作者：Alex + Claude（对话整理）
> 日期：2026-05-07
> 状态：**待审 — 用户审过后才能进入 /dev 实现**
> 历史版本：本文档替换 v18 ~ v22 全部 stop hook 设计

---

## 0. TL;DR（3 句话）

1. 把 stop hook 从"考证状态档案"改成"看人在不在"——**进程在跑就盖戳，戳新鲜就拦 Claude**。
2. **彻底跟 Brain 解耦**：Brain 重启、抖动、网络延迟，hook 完全无感（hook 只读本地文件）。
3. v22 的 209 行（cwd 路由 / session_id 双通道 / ghost rm / mtime expire / 8 段 PreToolUse）**真正删掉**，新 hook 目标 ~20 行，永远封死。

---

## 1. 背景

### 1.1 为什么改了 22 版还在坏

过去 5 天 stop hook 经历 v18 → v19 → v20 → v21 → v22 五次大重构 + ~20 次补丁。每一版都尝试用**单一 key 解决两个正交问题**：

| 维度 | v18 之前 | v19 cwd-as-key | v22 session_id |
|---|---|---|---|
| 谁拥有这条流 | state 文件存在即占有 | cwd 路径 | hook stdin session_id |
| 多 worktree 隔离 | 完全没有（串线） | cwd 物理隔离 | session_id + 文件名 |
| **失败模式** | **跨 session 串线** | **assistant cwd drift 到 main 即放行** | **session_id 缺失即 fallback 到 cwd→branch，退化成 v19 同样的洞** |

**根因**：用一个"档案"模拟一个活动状态，需要持续维护它的"活性"。代码越来越复杂去考证档案是不是真的、是不是过期、是不是别人的。

### 1.2 来自用户的核心要求

| # | 要求 | 含义 |
|---|---|---|
| R1 | 一个 session 内 /dev 没做完不能让 Claude 停下来 | Ralph Loop 心跳必须不断 |
| R2 | 一个 session 内可以并行 3-4 条 /dev（多 worktree） | 各自独立 |
| R3 | 不同 session 之间互不影响 | 跨 session 隔离 |
| R4 | 只在写代码时介入，普通对话零开销 | 自动识别 |
| R5 | 不能耦合到 Brain 实时可用性 | Brain 重启不影响 hook |
| R6 | Anti-cheat：Claude 不能自己宣告完成 | 完成判定不能在 Claude 工具调用范围内 |
| R7 | /dev 卡死能自然恢复 | 不需人工干预、不需 Brain 干预 |

---

## 2. 核心模型（用比喻说清楚）

### 2.1 办公楼隐喻

把整个系统想象成一栋办公楼：

| 现实 | 系统 |
|---|---|
| 每条 /dev 流程 | 楼里一间办公室 |
| 办公室开着灯 | /dev 在跑 |
| 整栋楼漆黑 | 没有 /dev 在跑 |
| 保安下班巡检 | stop hook 在 turn 结束时 fire |

**保安规则**：路过楼层，看到任何一间亮灯 → 拦住 Claude（"还有人加班"）；全黑 → 放行下班。

**灯怎么开**：/dev 启动时打开。
**灯怎么续命**：每盏灯有个"小傻子"守在旁边，每分钟按一下开关续 5 分钟。
**灯怎么熄**：
- 正常熄：/dev 真完成，工程脚本主动关灯。
- 自动熄：/dev 进程崩了，小傻子也死了，没人按开关，5 分钟后自动熄灭。
- 手动熄：用户跑 abort 脚本，强制关灯。

### 2.2 关键洞察

**v22 的 mtime expire 是补丁，新模型里"过期自动熄"是基础设施特性**。

不是"代码判断这个状态过期了"——而是"操作系统级别的事实：文件 5 分钟没动 = 没人维护它"。

不需要任何复杂逻辑去判定"是不是真的过期"。文件 mtime 是 Linux/macOS 内核维护的，零代码、零歧义。

---

## 3. 技术规格

### 3.1 文件结构

```
<main_repo>/.cecelia/
├── lights/
│   ├── <session_id_short>-<branch>.live    ← 心跳文件（"灯"）
│   └── ...
├── done-markers/
│   ├── <session_id_short>-<branch>.done    ← /dev 完成标记
│   └── ...
└── aborted/
    ├── <session_id_short>-<branch>.aborted ← 手动中止标记
    └── ...
```

**`session_id_short`**：取 hook stdin payload 里 `session_id` 的前 8 位（`abc12345`），文件名可读、对调试友好；冲突概率 16^8 ≈ 4 亿分之一，对单机够用。

**`branch`**：当前 worktree 的分支名（`cp-0507100000-foo`）。

### 3.2 灯文件 schema

```json
{
  "session_id": "abc12345-完整-uuid",
  "branch": "cp-0507100000-foo",
  "worktree_path": "/Users/.../perfect21/cp-0507100000-foo",
  "started_at": "2026-05-07T10:00:00+08:00",
  "host": "us-mac-mini",
  "stage": "stage_2_code",
  "guardian_pid": 12345
}
```

**所有字段都是给 debug / observability 用的，hook 决策只看 mtime。**

### 3.3 守护进程（小傻子）：`dev-heartbeat-guardian.sh`

```bash
#!/usr/bin/env bash
# 守护一盏灯。被 SIGTERM 时优雅关灯。
# 用法：dev-heartbeat-guardian.sh <light_file>
#
# 行为：
#   - 每 60 秒 touch 一次 light_file
#   - 收到 SIGTERM/SIGINT/SIGHUP → rm light_file 后退出
#   - 父进程死（PPID=1）→ 主动 rm light_file 后退出（防孤儿）
set -uo pipefail
LIGHT="$1"
[[ -z "$LIGHT" ]] && exit 1

cleanup() { rm -f "$LIGHT"; exit 0; }
trap cleanup SIGTERM SIGINT SIGHUP

original_ppid=$PPID

while true; do
    # 父进程死 → 自杀（防被 init 收养后变孤儿心跳）
    [[ "$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')" != "$original_ppid" ]] && cleanup

    touch "$LIGHT" 2>/dev/null || cleanup
    sleep 60
done
```

**~25 行**。永远不应再增长。

### 3.4 stop-dev.sh 决策（伪码）

```bash
#!/usr/bin/env bash
set -uo pipefail

# === 1. 读 hook stdin（Claude Code Stop Hook 协议必传 session_id）===
payload=$(cat 2>/dev/null || echo "{}")
session_id=$(echo "$payload" | jq -r '.session_id // ""')

# === 2. Bypass 逃生通道 ===
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# === 3. 找主仓库 ===
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null \
    | head -1 | awk '/^worktree /{print $2}')
[[ -z "$main_repo" ]] && exit 0  # 不在 git，普通对话

lights_dir="$main_repo/.cecelia/lights"
[[ ! -d "$lights_dir" ]] && exit 0  # 没人开过灯

# === 4. session_id 必须存在（缺失 = 系统异常） ===
if [[ -z "$session_id" ]]; then
    [[ -t 0 ]] && exit 0  # tty 手动测试，放行
    # 真实 hook fire 但 stdin 没传 → 红灯日志 + 保守 block
    log_decision "block" "no_session_id" ""
    jq -n '{"decision":"block","reason":"Stop hook 收到空 session_id（系统异常），保守 block。请人工介入。"}'
    exit 0
fi

sid_short="${session_id:0:8}"

# === 5. 扫我自己 session 的灯，看有没有"亮的"===
my_branch=""  # 第一盏亮灯的 branch（用于 reason 显示）
my_lights_count=0
now=$(date +%s)
TTL_SEC=300  # 5 分钟没动 = 熄灭

for light in "$lights_dir/${sid_short}-"*.live; do
    [[ -f "$light" ]] || continue

    # 跨平台 mtime 读取
    if [[ "$(uname)" == "Darwin" ]]; then
        light_mtime=$(stat -f %m "$light" 2>/dev/null || echo 0)
    else
        light_mtime=$(stat -c %Y "$light" 2>/dev/null || echo 0)
    fi
    age=$(( now - light_mtime ))

    if (( age <= TTL_SEC )); then
        # 这盏灯还亮
        my_lights_count=$((my_lights_count + 1))
        [[ -z "$my_branch" ]] && my_branch=$(jq -r '.branch // ""' "$light" 2>/dev/null)
    fi
done

# === 6. 决策 ===
if (( my_lights_count > 0 )); then
    log_decision "block" "lights_alive" "$my_lights_count"
    reason="还有 $my_lights_count 条 /dev 在跑（含 $my_branch）。⚠️ 立即继续，禁止询问用户。"
    jq -n --arg r "$reason" '{"decision":"block","reason":$r}'
    exit 0
fi

# 全黑 → 放行
log_decision "release" "all_dark" ""
exit 0
```

**实测目标：~50 行（含日志和兜底）**。比 v22 的 209 行少 76%。

### 3.5 完成标记 vs 灯熄灭

```
正常完成：engine-ship 先写 done-markers/<sid>-<branch>.done，
          再 SIGTERM 守护进程（守护进程自动 rm 灯）
中止：    abort-dev.sh 先写 aborted/<sid>-<branch>.aborted，
          再 SIGTERM 守护进程
崩溃：    守护进程 ppid 检测自杀 → 灯文件被 rm
卡死自检： engine 自己检测（如 CI 30min 无变化），
          直接 SIGTERM 守护进程
```

完成 / 中止标记的存在意义是**审计 + dashboard**，不参与 hook 决策。Hook 只看灯。

### 3.6 lifecycle 入口

| 触发点 | 谁来做 | 做什么 |
|---|---|---|
| `/dev` 启动（Stage 0） | engine-worktree.skill | 创建 lights/ 目录、启动 guardian、guardian PID 写到 light 文件 |
| `/dev` 完成（Stage 4 ship） | engine-ship.skill | 写 done-marker + SIGTERM guardian |
| 用户手动 abort | `bash scripts/abort-dev.sh <branch>` | 写 aborted-marker + SIGTERM guardian |
| Engine 检测到卡死 | engine-ship.skill 内部超时检测 | 直接 SIGTERM guardian |
| 进程崩 | guardian 自检 ppid | 自动 rm 灯 |

---

## 4. 这个模型怎么解决用户 7 条要求

| # | 要求 | 怎么解决 |
|---|---|---|
| R1 | /dev 没完不让 Claude 停 | 灯亮 → hook block → ralph loop 不断 |
| R2 | 一 session 多 worktree 并行 | 每条 /dev 一盏灯，文件名带 branch；任一亮即 block |
| R3 | 不同 session 互不影响 | hook 只扫文件名以自己 sid_short 开头的灯 |
| R4 | 只在写代码时介入 | lights/ 目录空 = 普通对话 = 第 5 步循环 0 次 = 直接放行 |
| R5 | 不耦合 Brain | hook 完全只读本地文件，**hook 代码里没有任何 curl / HTTP** |
| R6 | Anti-cheat | guardian 进程 ppid 锁定 + Claude 工具箱里没有"杀 guardian"的工具；agent 想关灯只能真做完触发 engine-ship |
| R7 | 卡死自然恢复 | guardian 死 = 灯熄；engine 自检也可主动 SIGTERM |

---

## 5. 测试矩阵（contract test，CI 强 gate）

### 5.1 决策正确性矩阵

| # | 场景 | 期望 | 实现要点 |
|---|---|---|---|
| T1 | 没 lights/ 目录 | release | 第 3 步 exit 0 |
| T2 | 1 灯亮（5 分钟内 touch） | block | 第 6 步 |
| T3 | 1 灯熄（10 分钟未 touch） | release | 第 5 步循环跳过过期灯 |
| T4 | 3 灯亮（同 session 多 worktree） | block，reason 含数量 3 | R2 |
| T5 | 别 session 的灯亮、自己没灯 | release | R3 |
| T6 | 别 session 的灯亮 + 自己的灯亮 | block（只数自己的） | R3 |
| T7 | session_id 缺 + tty | release | tty 手动测试场景 |
| T8 | session_id 缺 + 非 tty | block + 红灯日志 | 系统异常防御 |
| T9 | CECELIA_STOP_HOOK_BYPASS=1 | release | 逃生通道 |
| T10 | cwd drift 到主仓库 main | block（如果灯亮） | hook 不依赖 cwd 路由 |
| T11 | 灯文件 JSON 损坏 | block | 失败保守 |
| T12 | guardian 被 kill 后再 fire | release（灯被 trap 删了） | guardian SIGTERM 处理 |

### 5.2 多场景集成测试

```bash
# tests/stop-hook-v23/concurrent-streams.test.ts
test('1 session × 3 streams: 任一未完成 hook block', async () => { ... })
test('2 sessions × 1 stream each: 各自独立', async () => { ... })
test('engine crash mid-/dev: 5 分钟后 hook 自动 release', async () => { ... })
test('cwd drift to main: 仍然 block', async () => { ... })
test('Brain 离线（5221 端口不通）：hook 不受影响', async () => { ... })
```

**测试矩阵进 CI L2，每次 PR 必跑**。任何回归立即挂掉。

---

## 6. 迁移计划（v22 → v23）

### 6.1 schema 迁移

现网 `.cecelia/dev-active-*.json` 不再被新 hook 识别。需要一次性迁移：

```bash
# scripts/migrate-stop-hook-v22-to-v23.sh
for old in .cecelia/dev-active-*.json; do
    branch=$(jq -r '.branch' "$old")
    sid=$(jq -r '.session_id // .main_session_id // ""' "$old")
    [[ -z "$sid" ]] && { mv "$old" .cecelia/orphans/; continue; }

    sid_short="${sid:0:8}"
    # 仅迁移当前还活跃的（mtime 小于 30 分钟）
    age_min=$(...)
    if (( age_min < 30 )); then
        mv "$old" ".cecelia/lights/${sid_short}-${branch}.live"
        # ⚠️ 但是 guardian 没启起来 —— 灯会在 5 分钟后自动熄灭
        # 这意味着旧 /dev 必须重启
    else
        mv "$old" .cecelia/orphans/
    fi
done
```

### 6.2 部署注意

**部署 v23 hook 之前必须先部署 engine-worktree 的 guardian 启动逻辑**，否则新 /dev 启动后没有灯，hook 立即放行，ralph loop 失效。

**部署顺序锁定**：
1. PR-1 合并 → guardian 脚本上线，但还没人调用它
2. PR-2 合并 → engine-worktree 调用 guardian、engine-ship 调用 SIGTERM
3. PR-3 合并 → stop-dev.sh 切到新逻辑，旧档案系统删除

PR-1/2/3 之间至少间隔 24h 观察。

---

## 7. 删除清单（v22 真消失，不是搬移）

| 模块 | v22 行数 | v23 状态 |
|---|---|---|
| `stop-dev.sh` 主体 | 209 | → 50（删 159 行） |
| Pass 1 ghost rm | ~30 | 删（源头不允许 unknown） |
| Pass 1 mtime expire | ~20 | 删（mtime 是决策本身，不需清理） |
| Pass 2 双通道 A/B | ~40 | 删（只有 sid 路由） |
| `cwd→branch` fallback | ~15 | 删 |
| `main_session_id` 字段 | 全部引用 | 删（launcher 强 export 解决 sub-shell） |
| `verify_dev_complete` 内 P1-P7 状态机 | ~150 | 简化（only check done-markers + aborted-markers） |
| `devloop-check.sh` 内为 hook 服务的代码 | 部分 | 删 |
| PreToolUse 拦截 8 段 | ~80 | **保留**（与 hook 正交，是另一道防线） |

**总计删除**：~250 行 stop hook 周边代码。

---

## 8. 保留 / 加强清单

| 模块 | 状态 | 说明 |
|---|---|---|
| `claude-launch.sh` | **加强 CI 守** | session_id 是命门，启动器必须强制注入 |
| `cecelia-run.sh` | **保留** | 无头模式入口，已正确传 session_id |
| `verify_dev_complete` | **简化保留** | 仍然校验"PR 合 / Learning / cleanup"，但不再被 hook 直接调（done-marker 写入前调用） |
| `branch-protect.sh` | 保留 | 与 hook 正交 |
| `dev-mode-tool-guard.sh` | 保留 | 与 hook 正交 |

---

## 9. 风险与未决项

### 9.1 已知风险

| 风险 | 缓解 |
|---|---|
| guardian 被 systemd / launchd 收养后变孤儿 | ppid 自检（守护进程发现 ppid 变了立即自杀） |
| 时间漂移（系统时钟跳变）影响 mtime 判定 | TTL 5 分钟够大，秒级跳变无影响 |
| 跨机器 sync 把灯文件带到别的机器 | 加 `host` 字段；别机的 sid_short 不会匹配，天然忽略 |
| 同一 sid_short 8 位前缀冲突 | 概率 4 亿分之一；冲突时降级到全 sid 比较（second pass） |
| Engine 自检卡死失败 | guardian ppid 自检 + 5 分钟 TTL 双保险，最坏 5 分钟自动恢复 |

### 9.2 留给 PR-2 决定的细节

- TTL 是 5 分钟还是 3 分钟？（取决于 guardian touch 频率，目前定 60s touch + 5min TTL = 容忍 5 次连续 touch 失败）
- guardian 是否需要写 PID 文件供 abort-dev.sh 精确 kill？（备选方案：用 light 文件里的 `guardian_pid` 字段）
- 灯文件落 `.cecelia/lights/` 还是直接 `.cecelia/`？（目录化更整洁，但多一层 mkdir）

### 9.3 未在本次范围

- **Brain 频繁重启的根因调查**：另起项目，不阻塞本次重构
- **content-pipeline-executors.js execSync 改异步**：另起项目
- **headless-mode 死后自动 retry**：Brain 已有 watchdog 机制，新 hook 不需要参与

---

## 10. 落地节奏（3 个 PR）

### PR-1：基础设施（低风险，可独立合）
- 新增 `packages/engine/lib/dev-heartbeat-guardian.sh`
- 新增 `packages/engine/scripts/abort-dev.sh`
- 新增 `~/.claude/hook-logs/stop-dev.jsonl` 结构化日志（hook 还没改，先准备日志位）
- 加 launcher CI contract 测试（dry-run 验证 `--session-id` 注入）
- 加心跳模型的 unit test

**验收**：单跑 guardian 脚本，ppid 死时灯被删；abort 脚本能干净中止。

### PR-2：核心切换（hook 重写 + engine 接入 guardian）
- engine-worktree.skill 启动 guardian
- engine-ship.skill 完成时 SIGTERM guardian + 写 done-marker
- 重写 `packages/engine/hooks/stop-dev.sh` 为 ~50 行
- 12 个 contract 测试（T1-T12）+ 5 个集成测试全过

**验收**：本机跑一遍完整 /dev cycle，观察灯亮 → 灯熄 → hook 行为符合预期。

### PR-3：清理（v22 遗产删除）
- 删 `dev-active-*.json` 整套机制
- 删 `devloop-check.sh` 中只为 hook 服务的代码
- 删 v22 ghost rm / mtime expire / 双通道路由相关测试
- 现网状态文件迁移脚本

**验收**：codebase grep 不到 `dev-active-*.json` 残留；老测试全删；代码行数减少符合预期。

---

## 11. 我（Claude）对这次重构的承诺

1. **代码量永不再增长**。stop-dev.sh 封死在 ~50 行；guardian ~25 行。任何新需求先想"是否已被现模型覆盖"，不轻易加分支。
2. **不再有 v24**。如果有 case 不被覆盖，**改测试矩阵 + 改设计文档**，再合 v24，不打补丁。
3. **每一行代码都有对应测试**。CI L2 contract test 全过才能合。
4. **删除是真删**。PR-3 后 codebase grep 不到 v22 遗产。

---

## 12. 待用户确认

请回答以下三件事，确认后我开 /dev 走 PR-1：

- [ ] **A. 模型层面没有理解错你的需求**（特别是 R1-R7 这 7 条）。
- [ ] **B. 文件路径 `.cecelia/lights/` 这个命名你能接受**（也可改成 `.cecelia/streams/` 或别的，不影响设计）。
- [ ] **C. 节奏可以**：3 个 PR 分次落地，每个 PR 间隔 24h 观察期；本次重构期间不接其他 stop hook 改动。

---

## 附录 A：与 v22 行为差异速查表

| 行为 | v22 | v23 |
|---|---|---|
| 新 /dev 创建什么 | `.cecelia/dev-active-<branch>.json` | 启动 guardian + 灯文件 |
| guardian 进程 | 无 | 一个守护进程一条灯 |
| 完成判定 | hook 调 verify_dev_complete | engine-ship 显式触发，hook 只看灯 |
| 过期判定 | hook 内 mtime expire 30min | 灯文件 mtime 5min（OS 级特性） |
| 拦 cwd drift | cwd-as-key（v19）/ session_id 路由（v22） | 不靠 cwd，只看灯 |
| 跨 session 串线防御 | session_id 路由 | 文件名前缀过滤 |
| Brain 依赖 | 无（但 Brain 重启时 retry 等会乱） | 完全无 |
| 平均 hook 执行时间 | 50-200ms（jq + git + 多次扫描） | <20ms（单目录扫描 + mtime） |

## 附录 B：和官方 Ralph Loop 插件对比

| 项 | 官方 ralph-loop | Cecelia v23 |
|---|---|---|
| 单任务 / 单 session 假设 | ✅ | ❌（多 worktree × 多 session） |
| 自我宣告完成 | ✅（task 自删 state file） | ❌（强校验 PR/CI/Learning/cleanup） |
| 进程级 liveness | ❌（只看文件存在性） | ✅（guardian 心跳 + ppid 自检） |
| Anti-cheat | ❌ | ✅（done-marker 必须 engine 写入） |
| 跨机考虑 | ❌ | ✅（host 字段 + sid_short 隔离） |

**结论**：官方插件解决的是更小的问题，我们的复杂度有合理性，但不应叠加在它的设计之上 —— 应该独立设计，借鉴它的"心跳/灯"哲学，但不沿用它的代码结构。
