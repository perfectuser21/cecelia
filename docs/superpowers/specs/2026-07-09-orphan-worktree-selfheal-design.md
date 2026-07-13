# session resume 时孤儿 worktree 目录自愈重建

## 背景

`scripts/claude-launch.sh` 在交互模式 + 主仓工作树下会自动为每个 session 建一个专属 git worktree
（`~/worktrees/<repo>/session-<sid8>`），隔离多 session 互踩。但实测发现：如果这个 worktree 的
注册信息在中途被摘除（例如清理流程中断），目录本身仍留在磁盘上（可能只剩 `.claude/` 等残留），
launcher 目前只用 `[[ ! -d "$_WT_PATH" ]]` 判断"要不要建 worktree"——目录存在就直接 `cd` 进去，
完全不校验它是否还是主仓承认的合法 worktree。结果是 session 被静默丢进一个不受 git 管理的空壳目录，
后续所有 git 操作被迫跑去共享主仓做，有污染其他并发 session 工作状态的风险。

这是已知未根治缺口（`docs/superpowers/specs/2026-07-05-session-isolation-design.md` 记录的
"#3567 孤儿旧目录不回扫"）的一次实测复现。

## 目标

`claude-launch.sh` 的自动 worktree 分支在"目录已存在"时，先校验它是否仍是主仓登记的合法 worktree；
不合法则备份后自愈重建，而不是静默复用。

## 非目标

- 不处理 headless（`-p`）路径（本来就不建 worktree，不受影响）
- 不追查"注册为什么会被摘除"这个更上游的根因（属于另一个未解之谜，本次只做下游自愈）
- 不改动干净退出时的清理逻辑（`_DIRTY` 判断段），那部分行为不变

## 设计

### 判定合法性

```bash
_is_registered_worktree() {
    local dir="$1" main_repo="$2"
    local gitdir phys
    gitdir="$(git -C "$dir" rev-parse --git-dir 2>/dev/null)" || return 1
    phys="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
    git -C "$main_repo" worktree list --porcelain 2>/dev/null | grep -qx "worktree $phys"
}
```

两个条件都要满足：`rev-parse --git-dir` 成功（目录本身认为自己在某个 git 结构里）**且**
主仓 `worktree list --porcelain` 里能查到这个物理路径（主仓真的承认它）。只查前者不够——
孤儿目录里残留的 `.git` 文件可能指向已经不存在的 `.git/worktrees/<name>` 元数据，`rev-parse`
在这种情况下的行为不可靠，必须用主仓的登记表做交叉验证。

### 自愈流程

插入位置：`claude-launch.sh` 现有的

```bash
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    mkdir -p "$_WT_BASE"
    if [[ ! -d "$_WT_PATH" ]]; then
        ...
    fi
    cd "$_WT_PATH"
fi
```

改为：

```bash
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    mkdir -p "$_WT_BASE"

    if [[ -d "$_WT_PATH" ]] && ! _is_registered_worktree "$_WT_PATH" "$_MAIN_REPO"; then
        _ORPHAN_BACKUP="${_WT_PATH}.orphan-$(date +%s)"
        echo "[claude-launch] ⚠️ 孤儿 session 目录（非主仓登记 worktree）：$_WT_PATH → 备份到 $_ORPHAN_BACKUP" >&2
        mv "$_WT_PATH" "$_ORPHAN_BACKUP" \
            || { echo "[claude-launch] ❌ 备份孤儿目录失败，中止启动" >&2; exit 1; }
    fi

    if [[ ! -d "$_WT_PATH" ]]; then
        git -C "$_MAIN_REPO" fetch origin main --quiet 2>/dev/null || true
        if git -C "$_MAIN_REPO" rev-parse --verify "$_WT_BRANCH" &>/dev/null; then
            # 原分支还在（例如孤儿场景里分支未被清理）→ checkout 已有分支，不能再 -b
            git -C "$_MAIN_REPO" worktree add "$_WT_PATH" "$_WT_BRANCH" 1>&2
        else
            git -C "$_MAIN_REPO" worktree add "$_WT_PATH" -b "$_WT_BRANCH" origin/main 1>&2
        fi
    fi
    cd "$_WT_PATH"
fi
```

### 错误处理

- **mv 备份失败**（权限/磁盘满）→ 直接 `exit 1`，打印明确错误。不允许静默降级成"继续用旧目录"
  或"跳过 worktree 直接留在主仓"——那正是本次要修的问题本身。
- **原分支已被删除** → 走原有 `-b` 新建分支路径，无需额外处理（已是现有行为）。
- **原分支还在** → 新增 `worktree add <path> <branch>`（不带 `-b`）分支，checkout 已有分支而非新建，
  避免 `-b` 对已存在分支报错。

### 不处理的场景（有意留白）

- 主仓 `.git/index.lock` 被占用导致 `worktree add` 失败：这是已有行为（`set -euo pipefail` 会让
  整个脚本失败退出），本次不额外加重试——重试策略属于更大的"launcher 健壮性"话题，超出这次孤儿
  自愈的范围，留给后续单独评估。
- 自检本身的性能开销：两条 git 命令（`rev-parse --git-dir` + `worktree list`）都是本地操作，
  无网络调用，量级在毫秒级，不加超时保护。

## 测试策略

**Unit/Integration（vitest，`packages/engine/tests/launcher/claude-launch.test.ts`）**

在现有"Phase 7.7 claude-launch.sh 自动 worktree — 真实建立与清理" describe 块里新增一个 case：

1. 用 launcher 正常为某 session_id 建一次 worktree（复用现有 helper 模式）
2. 手动删除主仓 `.git/worktrees/<branch>` 目录，模拟"注册被摘除但目录残留"（不删工作目录本身）
3. 用同一 session_id 再次调用 launcher
4. 断言：
   - 新的 `_WT_PATH` 是合法已登记 worktree（`git worktree list` 能查到）
   - 旧目录内容被搬进了 `<path>.orphan-*` 备份路径，没有丢失
   - `git worktree list` 里不再有已失效的旧登记残影

这是逻辑接缝（纯 shell 脚本行为，不涉及真机/生产 env），CI test 覆盖已经足够，不需要额外的运行时
自检守卫——这段代码本身就是自愈逻辑，不是被自愈的对象。

## 验收标准

- [ ] failing test 先 commit（commit-1）：新增 case 断言"孤儿目录场景应自愈"，此时代码未修，测试应失败
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 现有全部 claude-launch.test.ts 测试仍通过（不破坏幂等复用/dirty 保留等既有行为）
- [ ] CI 全绿
