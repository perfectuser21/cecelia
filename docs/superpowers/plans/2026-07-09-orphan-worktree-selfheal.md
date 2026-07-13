# 孤儿 Worktree 自愈重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/claude-launch.sh` 的自动 worktree 分支在目标 session 目录已存在但不再是主仓登记的合法 worktree 时（孤儿目录），自动备份并重建，而不是静默把它当普通目录复用。

**Architecture:** 单文件改动。在 `scripts/claude-launch.sh` 里新增一个 `_is_registered_worktree()` 辅助函数，在现有"目录存在性检查"（`[[ ! -d "$_WT_PATH" ]]`）之前插入孤儿检测与备份逻辑；配套在 `packages/engine/tests/launcher/claude-launch.test.ts` 新增一个测试 case。

**Tech Stack:** Bash（launcher 脚本）、vitest + execSync（测试，沿用文件已有的真实 git 仓库 fixture 模式）。

## Global Constraints

- 只改 `AUTO_WORKTREE == 1` 分支内的逻辑，headless（`-p`/`--print`）路径完全不受影响
- 不改动干净退出清理段（`_DIRTY` 判断，第 181-199 行），行为保持不变
- 备份失败必须 `exit 1` 阻断启动，不允许静默降级
- 不加重试/超时机制（属于本次范围外，spec 已明确留白）

---

### Task 1: 孤儿 worktree 检测 + 自愈重建

**Files:**
- Modify: `scripts/claude-launch.sh:96-104`（真实执行分支，`AUTO_WORKTREE == 1` 段）
- Test: `packages/engine/tests/launcher/claude-launch.test.ts`（"Phase 7.7 claude-launch.sh 自动 worktree — 真实建立与清理" describe 块，紧接第 200-217 行"同一 session_id 再次启动 → 幂等复用"这个 case 之后新增）

**Interfaces:**
- Consumes：脚本里已有的变量 `$_WT_PATH`（session worktree 目标路径）、`$_MAIN_REPO`（主仓绝对路径）、`$_WT_BRANCH`（session 分支名，格式 `session-<sid8>`）
- Produces：新增 shell 函数 `_is_registered_worktree(dir, main_repo)` — 返回码 0=是登记合法的 worktree，非 0=不是；无其他文件依赖此改动的输出

- [ ] **Step 1: 写失败测试**

在 `packages/engine/tests/launcher/claude-launch.test.ts` 第 217 行（"同一 session_id 再次启动"这个 it 块的结尾 `});` 之后，`});`（describe 结尾）之前）插入新 case：

```typescript
  it('孤儿 worktree（目录残留但注册已被摘除）→ 自愈重建，旧内容备份不丢失', () => {
    writeMockClaude(`#!/usr/bin/env bash\npwd\nexit 0\n`);
    const sid = 'orphan001-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
      CLAUDE_PROJECTS_ROOT: projectsRoot,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;

    // 第一次启动：正常建立 worktree
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env });
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(existsSync(expectedWt)).toBe(true);
    writeFileSync(join(expectedWt, 'precious.txt'), 'do-not-lose-me');

    // 模拟孤儿：手动摘除主仓侧的 worktree 元数据登记，但保留目录内容
    // （git worktree remove 会连目录一起删；这里只删 .git/worktrees/<branch>
    //  这一份元数据，模拟"注册被摘除、目录残留"这个真实故障模式）
    const branchName = `session-${sid.slice(0, 8)}`;
    const wtMetaDir = join(mainRepo, '.git', 'worktrees', branchName);
    expect(existsSync(wtMetaDir)).toBe(true);
    rmSync(wtMetaDir, { recursive: true, force: true });

    // 此时旧目录仍在但已不被主仓承认
    const wtListBefore = execSync('git worktree list --porcelain', { cwd: mainRepo }).toString();
    expect(wtListBefore).not.toContain(expectedWt);

    // 第二次启动同一 session_id：应检测孤儿并自愈重建
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    expect(out.trim()).toBe(expectedWt);

    // 重建后的目录必须是主仓登记的合法 worktree
    const wtListAfter = execSync('git worktree list --porcelain', { cwd: mainRepo }).toString();
    const expectedWtPhys = realpathSync(expectedWt);
    expect(wtListAfter).toContain(`worktree ${expectedWtPhys}`);

    // 旧内容必须被搬进备份路径，没有丢失
    const backupDirs = require('node:fs').readdirSync(join(worktreeBase, 'main'))
      .filter((n: string) => n.startsWith(`${branchName}.orphan-`));
    expect(backupDirs.length).toBe(1);
    const backupPath = join(worktreeBase, 'main', backupDirs[0]);
    expect(existsSync(join(backupPath, 'precious.txt'))).toBe(true);
  });
```

**Step 1 需要的额外 import**：文件顶部第 2-5 行已有 `mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync, mkdirSync, lstatSync, realpathSync, symlinkSync`，`rmSync`/`existsSync`/`writeFileSync`/`realpathSync` 都已存在，无需新增 import。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts -t "孤儿 worktree"`
Expected: FAIL — 第二次 `execSync` 调用返回的 `out.trim()` 仍等于 `expectedWt`（因为当前代码只判断目录存在就直接 cd，没有校验合法性），但紧接着 `wtListAfter` 断言会失败，因为主仓从未重新 `worktree add`，`git worktree list --porcelain` 里查不到该路径。同时 `.orphan-` 备份目录也不存在，`backupDirs.length` 断言（`toBe(1)`）失败。

- [ ] **Step 3: 实现修复**

编辑 `scripts/claude-launch.sh`，在第 51-58 行 `_in_main_repo_worktree()` 函数定义之后（第 59 行空行处）新增辅助函数：

```bash
# 判断 $1 是否为 $2（主仓）登记承认的合法 worktree。
# 两个条件都要满足：目录自身认为在某个 git 结构里 + 主仓的 worktree 登记表里查得到它的物理路径。
# 只查前者不够——孤儿目录里残留的 .git 文件可能指向已经不存在的元数据。
_is_registered_worktree() {
    local dir="$1" main_repo="$2"
    local phys
    git -C "$dir" rev-parse --git-dir &>/dev/null || return 1
    phys="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
    git -C "$main_repo" worktree list --porcelain 2>/dev/null | grep -qx "worktree $phys"
}
```

然后把第 95-104 行：

```bash
# 真实执行：交互模式 + 主仓工作树 → 建立/复用 per-session worktree 并 cd 进去
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    mkdir -p "$_WT_BASE"
    if [[ ! -d "$_WT_PATH" ]]; then
        git -C "$_MAIN_REPO" fetch origin main --quiet 2>/dev/null || true
        # stdout 留给 claude 本体；git 的提示信息走 stderr
        git -C "$_MAIN_REPO" worktree add "$_WT_PATH" -b "$_WT_BRANCH" origin/main 1>&2
    fi
    cd "$_WT_PATH"
fi
```

替换为：

```bash
# 真实执行：交互模式 + 主仓工作树 → 建立/复用 per-session worktree 并 cd 进去
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    mkdir -p "$_WT_BASE"

    # 孤儿目录自愈：目录存在但已不是主仓登记的合法 worktree（例如注册被意外摘除、
    # 目录残留）→ 备份后重建，不能静默把它当普通目录复用（session-isolation #3567）。
    if [[ -d "$_WT_PATH" ]] && ! _is_registered_worktree "$_WT_PATH" "$_MAIN_REPO"; then
        _ORPHAN_BACKUP="${_WT_PATH}.orphan-$(date +%s)"
        echo "[claude-launch] ⚠️ 孤儿 session 目录（非主仓登记 worktree）：$_WT_PATH → 备份到 $_ORPHAN_BACKUP" >&2
        mv "$_WT_PATH" "$_ORPHAN_BACKUP" \
            || { echo "[claude-launch] ❌ 备份孤儿目录失败，中止启动" >&2; exit 1; }
    fi

    if [[ ! -d "$_WT_PATH" ]]; then
        git -C "$_MAIN_REPO" fetch origin main --quiet 2>/dev/null || true
        # stdout 留给 claude 本体；git 的提示信息走 stderr
        if git -C "$_MAIN_REPO" rev-parse --verify "$_WT_BRANCH" &>/dev/null; then
            # 原分支还在（孤儿场景里分支未必被清理）→ checkout 已有分支，不能再 -b
            git -C "$_MAIN_REPO" worktree add "$_WT_PATH" "$_WT_BRANCH" 1>&2
        else
            git -C "$_MAIN_REPO" worktree add "$_WT_PATH" -b "$_WT_BRANCH" origin/main 1>&2
        fi
    fi
    cd "$_WT_PATH"
fi
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts -t "孤儿 worktree"`
Expected: PASS

- [ ] **Step 5: 跑全部 launcher 测试确认无回归**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts`
Expected: 全部 PASS（含既有的"幂等复用"、"dirty 保留"、"账号切换"、"resume 历史软链"等 case）

- [ ] **Step 6: Commit（TDD 两段式）**

先确认测试文件的改动已经在 commit-1 里（Step 1 写的失败测试），实现代码在 commit-2：

```bash
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test(engine): 孤儿 worktree 场景断言 — 注册被摘除但目录残留应触发自愈重建

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

git add scripts/claude-launch.sh
git commit -m "fix(engine): claude-launch.sh 孤儿 worktree 自愈重建

session resume 到已存在目录时，原逻辑只判断目录是否存在就直接 cd 进去，
不校验是否仍是主仓登记的合法 worktree。若 worktree 注册被意外摘除（目录
残留），session 会被静默丢进不受 git 管理的空壳目录，后续 git 操作被迫
跑去共享主仓，有污染其他并发 session 状态的风险（session e85f1060 实测
复现，对应已知缺口 #3567）。

新增 _is_registered_worktree() 校验：目录自身 rev-parse 成功 + 主仓
worktree list 登记表查得到物理路径，两者都满足才算合法。不合法则先
mv 备份为 .orphan-<timestamp>（备份失败直接 exit 1，不静默降级），
再按原分支是否还在选择 checkout 已有分支或新建分支+worktree。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
