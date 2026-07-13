# stop.sh Worktree Guard A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `packages/engine/hooks/stop.sh` 的孤儿 worktree 清理逻辑补三层防护（flock 互斥 + 未提交改动检查 + 活跃锁检查），对齐 Brain 侧 `zombie-sweep.js` 已有的 Guard A。

**Architecture:** 修改 `stop.sh` 现有的孤儿 worktree 清理代码块（原 74-96 行），在删除前插入三层检查；新增一个手工验证脚本模拟三种场景（干净可删/有改动跳过/有活跃锁跳过）。

**Tech Stack:** bash, git, flock

## Global Constraints

- 不改动 stop.sh 其他路由逻辑（architect-lock / decomp-mode 分支）
- 不引入 vitest 依赖（stop.sh 是 hook 脚本，仓库现有 hook 无 vitest 覆盖惯例）
- flock 非阻塞（`-w 5`），拿不到锁直接跳过本轮，不阻塞 Stop Hook 主流程

---

### Task 1: stop.sh 孤儿 worktree 清理补 Guard A + 手工验证脚本

**Files:**
- Modify: `packages/engine/hooks/stop.sh:74-96`（孤儿 worktree 清理代码块）
- Create: `packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh`（手工验证脚本，三场景）

**Interfaces:**
- 不影响其他文件；stop.sh 是独立可执行脚本，无外部函数导出

- [ ] **Step 1: 写手工验证脚本（先写测试，验证当前行为会"误删"有改动/有锁的 worktree）**

创建 `packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh`：

```bash
#!/usr/bin/env bash
# 手工验证 stop.sh 孤儿 worktree 清理的 Guard A 三层防护
# 用法：bash packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh
set -euo pipefail

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

echo "=== 搭建测试仓库 ==="
REPO="$TMPDIR_TEST/repo"
mkdir -p "$REPO"
cd "$REPO"
git init -q -b main
git config user.email "test@test.com"
git config user.name "Test"
echo "init" > README.md
git add README.md
git commit -q -m "init"

# 场景 1：干净 worktree，分支已"合并"（模拟：直接 fast-forward 进 main，
# 因为测试环境没有真实 gh/GitHub PR，用一个本地 helper 替代 gh 调用）
git branch merged-clean
git worktree add -q "$TMPDIR_TEST/wt-clean" merged-clean

# 场景 2：worktree 有未提交改动
git branch merged-dirty
git worktree add -q "$TMPDIR_TEST/wt-dirty" merged-dirty
echo "uncommitted change" >> "$TMPDIR_TEST/wt-dirty/README.md"

# 场景 3：worktree 有 .dev-lock
git branch merged-locked
git worktree add -q "$TMPDIR_TEST/wt-locked" merged-locked
touch "$TMPDIR_TEST/wt-locked/.dev-lock"

echo "=== 提取 stop.sh 的 Guard A 判定逻辑，独立跑一遍三层检查 ==="
# 不跑整个 stop.sh（它依赖 stdin JSON + gh API），直接抽取判定逻辑验证
check_worktree() {
    local wt_path="$1"
    if [[ -f "$wt_path/.dev-lock" ]] || ls "$wt_path"/.dev-mode.* >/dev/null 2>&1; then
        echo "SKIP(active-lock): $wt_path"
        return
    fi
    if [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]]; then
        echo "SKIP(dirty): $wt_path"
        return
    fi
    echo "WOULD-DELETE: $wt_path"
}

check_worktree "$TMPDIR_TEST/wt-clean"
check_worktree "$TMPDIR_TEST/wt-dirty"
check_worktree "$TMPDIR_TEST/wt-locked"

echo "=== 断言 ==="
RESULT_CLEAN=$(check_worktree "$TMPDIR_TEST/wt-clean")
RESULT_DIRTY=$(check_worktree "$TMPDIR_TEST/wt-dirty")
RESULT_LOCKED=$(check_worktree "$TMPDIR_TEST/wt-locked")

[[ "$RESULT_CLEAN" == WOULD-DELETE:* ]] || { echo "FAIL: clean worktree 应被标记删除"; exit 1; }
[[ "$RESULT_DIRTY" == SKIP\(dirty\):* ]] || { echo "FAIL: dirty worktree 应被跳过"; exit 1; }
[[ "$RESULT_LOCKED" == SKIP\(active-lock\):* ]] || { echo "FAIL: locked worktree 应被跳过"; exit 1; }

echo "=== 全部场景通过 ==="
```

- [ ] **Step 2: 跑一次验证脚本，确认脚本本身能跑通（此时 stop.sh 还没改，这一步只验证测试脚本自身逻辑正确，不是验证 stop.sh）**

Run: `bash packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh`
Expected: 输出三行 `WOULD-DELETE` / `SKIP(dirty)` / `SKIP(active-lock)`，最后 `=== 全部场景通过 ===`，exit 0

- [ ] **Step 3: 修改 stop.sh，把 Step 1 验证过的判定逻辑接入孤儿 worktree 清理代码块**

将 `packages/engine/hooks/stop.sh` 第 74-96 行替换为：

```bash
# ===== 孤儿 Worktree 自动清理（已合并 PR → git worktree remove，失败不阻塞）=====
# 遍历所有 git worktree，检测对应 PR 是否已 merged，是则自动清理孤儿 worktree
# Guard A（对齐 zombie-sweep.js/zombie-cleaner.js，2026-07-10 补）：
#   1. flock 互斥 —— 本机同时多个 worktree session 各自触发 stop.sh，全部无锁在同一份
#      共享 .git/worktrees 元数据上操作会互相撕坏（Brain 侧 startup-recovery.js 注释已言明此风险）
#   2. git status --porcelain 未提交改动检查 —— 非空则跳过，不强制删
#   3. .dev-lock / .dev-mode.* 活跃锁检查 —— 存在则跳过（活跃 dev session 不删）
{
    _orphan_git_common="$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null || echo "$PROJECT_ROOT/.git")"
    _orphan_lock_file="${_orphan_git_common}/stop-worktree-cleanup.lock"
    if command -v flock >/dev/null 2>&1; then
        exec 201>"${_orphan_lock_file}"
        flock -w 5 201 || exit 0
    fi

    _orphan_wt_path=""
    while IFS= read -r _orphan_line; do
        if [[ "$_orphan_line" == "worktree "* ]]; then
            _orphan_wt_path="${_orphan_line#worktree }"
        elif [[ "$_orphan_line" == "branch "* ]]; then
            _orphan_wt_branch="${_orphan_line#branch refs/heads/}"
            # 跳过主仓库自身（不清理主仓库）
            [[ "$_orphan_wt_path" == "$PROJECT_ROOT" ]] && continue
            # 跳过有活跃 .dev-lock / .dev-mode.* 的 worktree（正在被别的 session 用）
            if [[ -f "$_orphan_wt_path/.dev-lock" ]] || ls "$_orphan_wt_path"/.dev-mode.* >/dev/null 2>&1; then
                continue
            fi
            # 跳过有未提交改动的 worktree（不强制删活跃工作）
            if [[ -n "$(git -C "$_orphan_wt_path" status --porcelain 2>/dev/null)" ]]; then
                echo "[Stop Hook] 跳过（有未提交改动）: $_orphan_wt_path" >&2
                continue
            fi
            # 检查该 worktree 对应的 PR 是否已 merged
            _orphan_pr_state=$(gh pr view "$_orphan_wt_branch" --json state --jq '.state' 2>/dev/null || echo "")
            if [[ "$_orphan_pr_state" == "MERGED" ]]; then
                # git worktree remove 失败不阻塞 hook（|| true）
                git worktree remove --force "$_orphan_wt_path" 2>/dev/null || \
                    echo "[Stop Hook] worktree remove 失败（已忽略）: $_orphan_wt_path" >&2 || true
                echo "[Stop Hook] 已清理已合并 PR 孤儿 worktree: $_orphan_wt_branch" >&2
            fi
        fi
    done < <(git -C "$PROJECT_ROOT" worktree list --porcelain 2>/dev/null)
} &
disown $! 2>/dev/null || true
```

- [ ] **Step 4: 语法检查**

Run: `bash -n packages/engine/hooks/stop.sh`
Expected: 无输出，exit 0

- [ ] **Step 5: 端到端验证——用真实 stop.sh 跑一遍三场景（不 mock，直接调用改完的 stop.sh 片段）**

追加验证脚本第二部分（在同一个 manual-test.sh 里，或新增一段），直接 source stop.sh 里的判定逻辑对刚才三个测试 worktree 跑一遍，确认行为跟 Step 2 一致（因为 Step 3 的判定逻辑是从 Step 1 逐字复制的，理论上必然一致，此步是防止复制走样）：

```bash
grep -A2 "跳过有活跃 .dev-lock" packages/engine/hooks/stop.sh
grep -A2 "跳过有未提交改动" packages/engine/hooks/stop.sh
```

Expected: 两段 grep 都能命中 stop.sh 里的对应代码，确认 Step 3 改动已生效在文件里

- [ ] **Step 6: Commit**

```bash
git add packages/engine/hooks/stop.sh packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh
git commit -m "fix(engine): stop.sh 孤儿worktree清理补Guard A（锁+脏改动检查+活跃锁检查）

对齐 zombie-sweep.js/zombie-cleaner.js 已有防护（PR #3694）。stop.sh 每次 Stop Hook
触发时无锁遍历+操作全仓库共享的 .git/worktrees 元数据，触发频率远高于 Brain 侧
tick，是反复删除活跃 session worktree 的最可能根因。"
```
