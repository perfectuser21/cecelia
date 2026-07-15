# claude-launch.sh 会话历史软链修复 —— slot 会话 `--resume` 找不到

Brain task: `d83ef7c9-428c-4cc4-a8fd-b1ce9c73c306`
PrepPRD: `sprints/07150852-fix-slot-session-history-orphan-key/prep-prd.md`

## 背景

### 现场

用户在 slot 里开的会话（智能获客 `e2d67c75`）关掉后，主仓 `claude --resume` 报
`No conversation found with session ID: e2d67c75-…`，以为会话丢了。已复发 ≥2 次
（07-13 `7f7a2e70`、07-15 `e2d67c75`）。

### 根因（已复现坐实）

`scripts/claude-launch.sh:162` 的 `_link_projects_dir` 只在 `AUTO_WORKTREE == 1` 时执行，
而 `AUTO_WORKTREE` 的判据（第 75 行）要求 **cwd 在主仓**（`_in_main_repo_worktree`）：

```bash
if ! _is_headless && [[ "${CECELIA_NO_AUTO_WORKTREE:-0}" != "1" ]] && _in_main_repo_worktree; then
    AUTO_WORKTREE=1
    ...
fi
...
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _link_projects_dir || echo "[claude-launch] ⚠️ projects 软链失败..." >&2
fi
```

从**已存在的 worktree 内**启动 claude（slot 复用上一个会话的终端目录）→ `AUTO_WORKTREE=0`
→ 软链不执行 → Claude Code 按 `process.cwd()` 派生 key 建**真目录**
→ 历史落主池之外 → 主仓 `--resume` 只读主仓 key 的池子，看不见。

证据：

| 证据 | 内容 |
|---|---|
| `--dry-run` 复现 | 主仓启动输出含 `ln -s`；worktree 内启动无。确定性，非偶发 |
| 生产实证 | `e2d67c75` 的 project key = `-Users-administrator-worktrees-zenithjoy-session-9cc9a05b`，即启动时 cwd 在该 worktree |
| 统计 | 48 个 zenithjoy worktree key：43 个软链（从主仓起）、5 个真目录（从 worktree 内起） |
| 排除老版遗留 | 软链机制 2026-07-06 已进 main（#3567），而孤儿产生于 07-09/07-14 |

后果量化：5 个孤儿 key 压了 13 条真实会话。

### 次因：软链生命周期挂错主体

清理段（220-223 行）在干净退出时 `rm` 掉软链。但软链是 **per-worktree-path 的共享资源**，
不是 per-session 私有资源：同一 worktree key 曾压 4 条会话
（`9cc9a05b` / `26f662f5` / `cee71334` / `e2d67c75`）。第一个会话干净退出删掉共享软链后，
仍在用该 key 的会话再写就重建成真目录 = 新孤儿。

**采纳「解耦门禁」后此缺陷会放大**：建链的会话变多，删链的责任仍只在主仓分支——
建者众、删者独，删的还是别人的链。故必须同刀落地。

### 两颗已实证的潜伏炸弹

**炸弹 1：key 算法是错的**（探针实证）

第 72 行 `_path_to_project_key() { printf '%s' "${1//[\/.]/-}"; }` 只替换 `/` 和 `.`。
实跑 claude 二进制探针：

```
真实 cwd      : /private/tmp/keyprobe/key_Probe.Test A/sub_dir
claude 的 key : -private-tmp-keyprobe-key-Probe-Test-A-sub-dir
现算法        : -private-tmp-keyprobe-key_Probe-Test A-sub_dir   ✗ 保留了 _ 和空格
```

真实规则 = **每个非字母数字字符各换一个 `-`**，大小写与数字保留。
当前路径恰好都不含 `_`/空格所以未爆；一旦分支名或目录名出现 `_`（如 `task_17bca0f8`），
脚本建的链名与 Claude 实际用的 key 差一个字符 → 链指空 → **症状与本 bug 完全一致、极难归因**。

> 这正是既有教训 `docs/learnings/cp-07061211-resume-history-symlink.md`
> 「对第三方工具行为的假设（路径语义/编码规则）必须找实存证据实证」的第二层复发。

**炸弹 2：`CLAUDE_PROJECTS_ROOT` 是假旋钮**（strings 实证）

```
strings claude.exe | grep -c CLAUDE_PROJECTS_ROOT  →  0
strings claude.exe | grep -c CLAUDE_CONFIG_DIR     →  24
```

Claude Code 本体**不读** `CLAUDE_PROJECTS_ROOT`，只认 `CLAUDE_CONFIG_DIR`。
现有契约测试靠它把 root 指到 tmp 跑绿 = **测试绿、生产不认**。

生产之所以没炸，是因为 `~/.claude-account{1,2,3}/projects` 都是软链指向 `~/.claude/projects`
（inode 582971 一致，实测）——这是手工设置、代码无保障的巧合。

## 目标

1. 任何**交互式**启动，只要最终 cwd 是某主仓的 linked worktree，其 project key 必须软链回主仓 key。
2. 软链**只建不删**，生命周期与任何单个会话解耦。
3. key 算法与 Claude Code 实际规则**逐字符一致**。
4. root 与 Claude Code 同源（由 `CLAUDE_CONFIG_DIR` 派生）。
5. 沿用既有铁律：launcher 必经路径上的新增逻辑一律 **best-effort**，失败只 stderr 告警，
   **绝不阻断 claude 启动**；stdout 完整留给 claude 本体。

**明确不做**：

- ❌ **不做自动 sweep 存量孤儿**。`_path_to_project_key` 是有损多对一映射（`/`、`.`、原生 `-`
  全塌成 `-`），反推不可判定。已实证：`/Users/administrator/perfect21/zenithjoy-skills` 是独立
  repo，其 key 以主仓 key 为前缀 → 前缀匹配会把它的历史并进 zenithjoy 主池，不可逆；
  `-Users-administrator-worktrees-cecelia-gp-orchestrator-flag`（压着 3 条真会话）两种反推候选
  在盘上都不存在。且需要 sweep 的孤儿其 worktree 已被清理段删除，stat 探测必失败——
  **能反推的不需要 sweep，需要 sweep 的反推不了**。存量已于 2026-07-15 手工并回并校验，
  剩余跨 repo 孤儿出人工清单由用户拍板。
- ❌ **headless（`-p`）不软链**。机器人会话（Brain tick / ci-patrol / nightly）灌进主池会淹没
  `/resume` 列表 —— 那正是本 bug 症状的另一种形态，换姿势复发。
- ❌ 不建正向台账 `.wt-map.jsonl`（YAGNI：正向 `--git-common-dir` 已足够定位主仓）。

## 设计

### 改动 1：key 算法与 Claude Code 对齐

```bash
# Before（只换 / 和 .，与 Claude Code 实际规则不符）
_path_to_project_key() { printf '%s' "${1//[\/.]/-}"; }

# After（每个非字母数字字符各换一个 -，探针实证）
# Claude Code 用 process.cwd() 派生 key：非字母数字一律 -，大小写与数字保留。
# 逐字符替换，不合并连续分隔符。
_path_to_project_key() { printf '%s' "${1//[^a-zA-Z0-9]/-}"; }
```

### 改动 2：root 与 Claude Code 同源，账号解析提前

`CLAUDE_CONFIG_DIR` 原在 184-192 行设置，晚于软链（162 行）。将该段**提前**到软链之前，
并让 root 由它派生：

```bash
# Before
local root="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"

# After
# CLAUDE_PROJECTS_ROOT 仅供测试注入；Claude Code 本体不读它（strings 实证 0 命中），
# 生产必须由 CLAUDE_CONFIG_DIR 派生，与 claude 本体同源，杜绝"测试绿、生产错"。
local root="${CLAUDE_PROJECTS_ROOT:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects}"
```

### 改动 3：解耦门禁 —— 按最终 cwd 统一判定

不再问"是不是 launcher 自己建的 worktree"，改为在 `cd` 完成后按**最终 cwd** 统一判定。
两条路径（launcher 建的 / 外部已存在的）自然收敛到同一段逻辑：

```bash
# 主仓路径正向求出（在 worktree 内也有效）：
#   主仓：      git-dir == git-common-dir
#   linked wt： git-dir = <main>/.git/worktrees/<n>，git-common-dir = <main>/.git
# 判据与 packages/engine/hooks/main-repo-write-guard.sh 保持一致（cp-07051816 教训）。
_resolve_main_repo() {
    local cmn
    cmn="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    cmn="$(cd "$cmn" 2>/dev/null && pwd -P)" || return 1
    dirname "$cmn"
}

# 交互模式 + cwd 是 linked worktree → 建链（无论 worktree 是谁建的）
if ! _is_headless && ! _in_main_repo_worktree; then
    _link_projects_dir || echo "[claude-launch] ⚠️ projects 软链失败..." >&2
fi
```

**放置时机（关键）**：这段必须放在自动 worktree 的 `cd "$_WT_PATH"`（129 行）**之后**、
`exec`/前台执行 claude **之前**。两条路径由此收敛：

| 启动场景 | cd 后的 cwd | `! _in_main_repo_worktree` | 结果 |
|---|---|---|---|
| 主仓 + 交互（launcher 建 worktree 并 cd 进去） | 新建的 worktree | true | 建链 ✅ |
| **已存在 worktree 内 + 交互**（本 bug） | 该 worktree | true | 建链 ✅ **（修复点）** |
| 主仓 + 交互 + `CECELIA_NO_AUTO_WORKTREE=1` | 主仓 | false | 不建链（key 即主仓 key，无需链）✅ |
| headless（`-p`） | 任意 | —— | 短路，不建链 ✅ |

> 逃生阀 `CECELIA_NO_AUTO_WORKTREE=1` 只管"不自动建 worktree"，**不参与建链判定**。
> 带阀但 cwd 已在 worktree 内时仍应建链——否则逃生阀会变成新的丢会话入口。

**`_link_projects_dir` 的入参随之改变**：原先读全局 `$_WT_PATH` / `$_MAIN_REPO`
（仅 `AUTO_WORKTREE=1` 时才有值），解耦后必须改为按**当前 cwd** 自行求解，
不再依赖 auto-worktree 分支的产物：

```bash
_link_projects_dir() {
    local wt_phys main_repo root target link
    wt_phys="$(pwd -P)" || return 1              # 当前 cwd 的物理路径（不是 $_WT_PATH）
    main_repo="$(_resolve_main_repo)" || return 1
    root="${CLAUDE_PROJECTS_ROOT:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects}"
    target="$root/$(_path_to_project_key "$main_repo")"
    link="$root/$(_path_to_project_key "$wt_phys")"
    [[ "$link" == "$target" ]] && return 0
    ...
}
```

### 改动 4：软链只建不删

```bash
# Before（220-223 行）
if [[ -n "${_PROJ_LINK_CREATED:-}" && -L "$_PROJ_LINK_CREATED" ]]; then
    rm "$_PROJ_LINK_CREATED" 2>/dev/null || true
fi

# After —— 整段删除
# 软链是 per-worktree-path 的共享资源（同一 key 可压多条会话），不是 per-session 私有资源。
# 删它会让仍在用该 key 的会话重建真目录 = 新孤儿。一个软链 8 字节，留着零成本。
```

### 改动 5：`pwd -P` 失败改硬失败

```bash
# Before（回退给逻辑路径 → key 算错 → 建出对不上的死链，比不建链更坏）
wt_phys="$(cd "$_WT_PATH" 2>/dev/null && pwd -P)" || wt_phys="$_WT_PATH"

# After
wt_phys="$(cd "$_WT_PATH" 2>/dev/null && pwd -P)" || return 1
```

### 改动 6：安全护栏

```bash
# -L 先验：`-d` 对"指向目录的软链"也为真。sweep/merge 分支若漏判，
# 遍历的将是主池上百条真实会话并把它们搬走 —— 全场最大灾难面。
_is_real_dir() { [[ -d "$1" && ! -L "$1" ]]; }

# 自指短路：link == target 时 `ln -s X X` 成环，/resume 遍历会 ELOOP
[[ "$link" == "$target" ]] && return 0

# ln -sfn：-n 使 macOS 不跟随已存在的目录软链，避免把链建到 link/ 内部
ln -sfn "$target" "$link"
```

### 改动 7：孤儿真目录并回改为不覆盖

```bash
# Before（同名文件静默覆盖主池那份真实历史，无备份无告警）
mv "$f" "$target/" || return 1

# After（冲突改名保留 + 显式告警；既不覆盖主池，也不静默丢弃 worktree 侧）
if [[ -e "$target/$(basename "$f")" ]]; then
    mv "$f" "$target/$(basename "$f").orphan-$(date +%s)" || return 1
    echo "[claude-launch] ⚠️ 会话冲突，已改名保留：$(basename "$f")" >&2
else
    mv -n "$f" "$target/" || return 1
fi
```

### 改动 8：并发锁

竞争边界在 **projects 池**（多 repo 共用一个池），不在 git-dir。
抄 `scripts/quickcheck.sh:14-35` 的 flock + mkdir 双路范式（**macOS 无 `flock(1)`**）。

```bash
# best-effort：拿不到锁只告警跳过建链，绝不阻断启动（沿用 163 行既有纪律）
# 注意：若用 flock 的 FD，务必防止泄漏给后续 exec 出去的 claude 进程
#（worktree-manage.sh:288 已有此坑的注释）
```

### 改动 9：dry-run 契约同步

dry-run（89-104 行）目前只在 auto-worktree 分支打印 `ln -s` 契约行。解耦后
「已在 worktree 内启动」也会建链，dry-run 必须如实反映——否则契约测试断言不到，
且 dry-run 作为「意图契约」会与真实行为漂移。

```bash
# auto-worktree 分支：worktree 尚未建，key 按将要 cd 进去的 _WT_PATH 派生（现有行为，保留）
# 已在 worktree 内：key 按当前 cwd 派生，同样打印 ln -s 契约行（新增）
```

> 沿用既有铁律（`cp-07051816` 教训）：launcher 的 **stdout 完整留给 claude 本体**，
> 新增的 `git rev-parse` 等辅助调用一律 `2>/dev/null` 且不得往 stdout 吐。
> dry-run 是唯一例外（它本就以 stdout 输出契约后 `exit 0`）。

## 测试策略

| 层级 | 用例 | 现状 |
|---|---|---|
| 契约（dry-run） | cwd 已在**外部建的** worktree 内 → 输出含 `ln -s` | 🔴 新增，现在必红 |
| 契约（dry-run） | key 算法：含 `_` / 空格 / 大写的路径 → key 与探针实测规则一致 | 🔴 新增，现在必红 |
| 集成（真实建链） | 同一 key 多会话共用 → 第一个干净退出后**软链仍在** | 🔴 新增，现在必红 |
| 集成（真实建链） | 孤儿真目录与主池**同名文件** → 不覆盖，冲突改名 + 告警 | 🔴 新增，现在必红 |
| 回归 | headless（`-p`）→ 仍**不**建链 | ✅ 已有，须保持绿 |
| 回归 | best-effort：projects root 只读 → 软链失败不阻断启动，退出码透传 | ✅ 已有（446 行），须保持绿 |

**须改判的既有用例**：`packages/engine/tests/launcher/claude-launch.test.ts:411`
「干净退出 → 软链被删除」把 bug 写成了预期行为，随改动 4 一起翻。

**测试注入改用 `CLAUDE_CONFIG_DIR`**（而非假旋钮 `CLAUDE_PROJECTS_ROOT`），
让测试路径与生产路径同源。

**proven-to-fire**：合并前必须亲眼看每条新用例在未修代码上报红一次。

## 验收标准

- [ ] 4 条 failing test 先 commit（commit-1）
- [ ] 修复代码让其变绿（commit-2）
- [ ] 已亲眼看守卫报红过一次
- [ ] CI 全绿
