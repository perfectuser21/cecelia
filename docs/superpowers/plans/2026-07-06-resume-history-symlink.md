# resume 历史软链回主仓 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** claude-launch.sh 建 per-session worktree 后把 `~/.claude/projects/<wt_key>` 软链到主仓 key，`/resume` 在任意 session worktree 内可见全部历史。

**Architecture:** 在 launcher `cd "$_WT_PATH"` 之后、claude 启动之前插入 best-effort 软链函数（含孤儿真实目录迁移）；干净退出清理 worktree 的同一分支里删软链；`--dry-run` 追加 `ln -s` 契约行。projects 根 `${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}` 可 env 覆盖供测试沙箱。

**Tech Stack:** bash（scripts/claude-launch.sh）+ vitest（packages/engine/tests/launcher/claude-launch.test.ts，沿用既有 mock-claude 沙箱模式）。

**Spec:** docs/superpowers/specs/2026-07-06-resume-history-symlink-design.md

**关键事实（已实证，不要再查）：**
- Claude Code projects key = 绝对路径中 `/` 和 `.` 逐字符替换为 `-`（如 `/Users/x/worktrees/cecelia/session-ab12` → `-Users-x-worktrees-cecelia-session-ab12`）
- 三账号 `~/.claude-accountN/projects` 均已软链至 `~/.claude/projects`，默认根覆盖所有账号
- repo 内零代码依赖 `<session-key>` 是真实目录
- 项目文件夹内容 = `<uuid>.jsonl` + 同名 uuid 子目录，mv 迁移无碰撞风险

---

### Task 1: TDD commit-1 — 全部 failing test（含既有测试沙箱加固）

**Files:**
- Modify: `packages/engine/tests/launcher/claude-launch.test.ts`

**NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。本 task 只改测试文件，不碰 launcher。**

- [ ] **Step 1: 给既有「真实建立与清理」describe 块（第 128-213 行）的 3 个测试补 CLAUDE_PROJECTS_ROOT 沙箱**

在该 describe 的 `beforeAll` 里（`mockDir = mkdtempSync(...)` 之后）加：

```ts
    projectsRoot = join(base, 'projects-root');
```

并在块顶部声明 `let projectsRoot: string;`。然后给该块 3 个测试的 `env` 对象各加一行：

```ts
      CLAUDE_PROJECTS_ROOT: projectsRoot,
```

（目的：真实执行测试不再往开发机真实 `~/.claude/projects` 留 tmp 路径垃圾软链。）

- [ ] **Step 2: 文件末尾追加新 describe 块（5 个 failing test）**

```ts
describe('resume 历史软链 — per-session projects key 软链回主仓', () => {
  let base: string;
  let bareDir: string;
  let mainRepo: string;
  let mockDir: string;
  let worktreeBase: string;
  let projectsRoot: string;

  const toKey = (p: string): string => p.replace(/[/.]/g, '-');

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'claude-launch-symlink-'));
    bareDir = join(base, 'origin.git');
    execSync(`git init -q --bare "${bareDir}"`);
    mainRepo = join(base, 'main');
    execSync(`git clone -q "${bareDir}" "${mainRepo}"`);
    execSync('git config user.email test@test.com', { cwd: mainRepo });
    execSync('git config user.name Test', { cwd: mainRepo });
    writeFileSync(join(mainRepo, 'README.md'), 'x');
    execSync('git add . && git commit -q -m init', { cwd: mainRepo });
    execSync('git branch -M main', { cwd: mainRepo });
    execSync('git push -q -u origin main', { cwd: mainRepo });
    worktreeBase = join(base, 'worktrees-base');
    projectsRoot = join(base, 'projects-root');
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-symlink-mock-'));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    rmSync(mockDir, { recursive: true, force: true });
  });

  function writeMockClaude(script: string): void {
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, script);
    chmodSync(mockClaude, 0o755);
  }

  function makeEnv(sid: string): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
      CLAUDE_PROJECTS_ROOT: projectsRoot,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    return env;
  }

  it('auto-worktree 启动 → claude 运行期内 <wt_key> 是指向 <main_key> 的软链', () => {
    const sid = 'aaaa0001-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPath));
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain(`LINK_TARGET=${join(projectsRoot, toKey(mainRepo))}`);
  });

  it('孤儿真实目录 → 内容迁入主仓文件夹并原位替换为软链', () => {
    const sid = 'aaaa0002-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const orphanDir = join(projectsRoot, toKey(wtPath));
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, 'old-session.jsonl'), '{"role":"user"}\n');
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${orphanDir}" ]]; then echo "IS_LINK=yes"; else echo "IS_LINK=no"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain('IS_LINK=yes');
    expect(existsSync(join(projectsRoot, toKey(mainRepo), 'old-session.jsonl'))).toBe(true);
  });

  it('干净退出 → 软链被删除，经软链写入主仓文件夹的 transcript 完好', () => {
    const sid = 'aaaa0003-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPath));
    writeMockClaude(`#!/usr/bin/env bash
echo '{"x":1}' > "${link}/${sid}.jsonl"
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(existsSync(link)).toBe(false);
    expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(projectsRoot, toKey(mainRepo), `${sid}.jsonl`))).toBe(true);
  });

  it('脏 worktree 保留 → 软链同步保留', () => {
    const sid = 'aaaa0004-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPath));
    writeMockClaude(`#!/usr/bin/env bash
echo dirty > uncommitted.txt
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(existsSync(join(wtPath, 'uncommitted.txt'))).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('--dry-run（auto-worktree 分支）→ 输出含 ln -s 契约行', () => {
    const sid = 'aaaa0005-1111-2222-3333-444444444444';
    const env = makeEnv(sid);
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    expect(out).toContain('ln -s');
    expect(out).toContain(toKey(mainRepo));
  });
});
```

同时把文件头 import 行补上缺的符号（`mkdirSync`、`lstatSync`）：

```ts
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync, mkdirSync, lstatSync } from 'node:fs';
```

- [ ] **Step 3: 跑测试确认新增 5 个全红、既有测试全绿**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts 2>&1 | tail -20`
Expected: 既有 11 个 PASS；新 describe 5 个 FAIL（软链不存在 / LINK_TARGET=MISSING / 无 ln -s 输出）。

- [ ] **Step 4: Commit（commit-1，只含测试）**

```bash
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test(launcher): resume 历史软链 5 case failing test + 既有真实执行测试补 CLAUDE_PROJECTS_ROOT 沙箱"
```

---

### Task 2: TDD commit-2 — launcher 实现（变绿）

**Files:**
- Modify: `scripts/claude-launch.sh`

- [ ] **Step 1: 在 `_in_main_repo_worktree()` 函数之后（第 44 行后）加 key 函数**

```bash
# Claude Code projects key：绝对路径中 / 和 . 逐字符替换为 -
_path_to_project_key() { printf '%s' "$1" | sed 's#[/.]#-#g'; }
```

- [ ] **Step 2: dry-run 块（现第 62-71 行）的 auto-worktree 分支追加 ln -s 契约行**

`echo "cd \"$_WT_PATH\""` 之后加：

```bash
        _PROJ_ROOT="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"
        echo "ln -s \"$_PROJ_ROOT/$(_path_to_project_key "$_MAIN_REPO")\" \"$_PROJ_ROOT/$(_path_to_project_key "$_WT_PATH")\""
```

- [ ] **Step 3: 真实执行段 `cd "$_WT_PATH"`（现第 81 行）之后加软链建立**

```bash
# 会话历史软链：<wt_key> → <main_key>，让 transcript 汇聚主仓池子，/resume 可见全部历史。
# best-effort：任何失败只警告，绝不阻断 claude 启动。
_link_projects_dir() {
    local root="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"
    local target link f
    target="$root/$(_path_to_project_key "$_MAIN_REPO")"
    link="$root/$(_path_to_project_key "$_WT_PATH")"
    mkdir -p "$target" || return 1
    if [[ -L "$link" ]]; then
        [[ "$(readlink "$link")" == "$target" ]] && return 0
        rm "$link" || return 1
    elif [[ -d "$link" ]]; then
        # 孤儿真实目录：内容并回主仓池子；任一 mv 失败则中止（保留真实目录，不建软链）
        for f in "$link"/* "$link"/.[!.]*; do
            [[ -e "$f" ]] || continue
            mv "$f" "$target/" || return 1
        done
        rmdir "$link" || return 1
    fi
    ln -s "$target" "$link"
}
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _link_projects_dir || echo "[claude-launch] ⚠️ projects 软链失败，本 session 历史将不共享（不影响启动）" >&2
fi
```

注意：函数定义放在 `cd "$_WT_PATH"` 所在 `if` 块的**外面**（紧跟其后），调用套在 `AUTO_WORKTREE` 判断里，与脚本现有风格一致。

- [ ] **Step 4: 清理段（现第 131-134 行）worktree 真被 remove 的分支里删软链**

`git -C "$_MAIN_REPO" branch -D "$_WT_BRANCH" ...` 之后加：

```bash
        # 只删软链本身（-L 先验），绝不跟随进主仓文件夹
        _PROJ_LINK="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}/$(_path_to_project_key "$_WT_PATH")"
        if [[ -L "$_PROJ_LINK" ]]; then rm "$_PROJ_LINK" 2>/dev/null || true; fi
```

- [ ] **Step 5: 语法冒烟 + 跑测试确认全绿**

Run: `bash -n scripts/claude-launch.sh && cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts 2>&1 | tail -10`
Expected: 16 个测试全 PASS。

- [ ] **Step 6: Commit（commit-2，只含实现）**

```bash
git add scripts/claude-launch.sh
git commit -m "feat(launcher): per-session worktree 的 projects key 软链回主仓，/resume 恢复全部历史"
```

---

### Task 3: 工程合规 — 版本 bump + registry + PRD/DoD + learning

**Files:**
- Modify: `packages/engine/VERSION`、`packages/engine/hooks/VERSION`、`packages/engine/.hook-core-version`、`packages/engine/package.json`、`packages/engine/package-lock.json`、`packages/engine/regression-contract.yaml`、`packages/engine/feature-registry.yml`
- Create: `PRD.cp-07061211-resume-history-symlink.md`、`DoD.cp-07061211-resume-history-symlink.md`、`docs/learnings/cp-07061211-resume-history-symlink.md`

- [ ] **Step 1: Engine 版本 19.3.0 → 19.4.0（6 处）**

```bash
cd packages/engine && npm version minor --no-git-tag-version && cd ../..
printf '19.4.0\n' > packages/engine/VERSION
printf '19.4.0\n' > packages/engine/hooks/VERSION
printf '19.4.0\n' > packages/engine/.hook-core-version
grep -n "19.3.0" packages/engine/regression-contract.yaml
# 把上面 grep 命中的版本字段改成 19.4.0（用 Edit 工具改，保留 yaml 其余内容）
```

注意：先看 VERSION / hooks/VERSION / .hook-core-version 现有文件是否带换行，保持原格式（`cat -A` 确认）。

- [ ] **Step 2: feature-registry.yml changelog 追加**

在 `changelog:` 列表末尾（对齐既有 19.3.0 条目格式）追加：

```yaml
  - version: "19.4.0"
    date: "2026-07-06"
    type: "feat"
    description: "resume 历史软链（cp-07061211）— claude-launch.sh 建 per-session worktree 后把 ~/.claude/projects/<wt_key> 软链到主仓 key（孤儿真实目录先迁移合并），干净退出随 worktree 清理软链（-L 先验只删链接），--dry-run 追加 ln -s 契约行，CLAUDE_PROJECTS_ROOT 可覆盖供测试沙箱。修 #3557 副作用：/resume 按 cwd 过滤导致历史全部不可见。全段 best-effort 不阻断启动。5 case TDD + 既有真实执行测试补沙箱。"
    files:
      - "../../scripts/claude-launch.sh (projects key 软链建立/迁移/清理)"
```

- [ ] **Step 3: 跑 generate-path-views.sh（如产生 diff 一并提交）**

```bash
find packages/engine -name "generate-path-views.sh" -not -path "*/node_modules/*" -exec bash {} \;
git status --porcelain
```

- [ ] **Step 4: 写 PRD 文件**

`PRD.cp-07061211-resume-history-symlink.md`：

```markdown
# PRD — resume 历史软链回主仓（修 session 隔离副作用）

## 背景

PR #3557 session 隔离后每个交互 session 落唯一 cwd，Claude Code 按 cwd 派生 projects key 存 transcript，
/resume 按当前 cwd 的 key 过滤 → 只见当前 session 自己，历史全部不可见，且持续产生孤儿文件夹。

## 目标

per-session worktree 的 projects key 软链到主仓 key，transcript 汇聚一池，
/resume 在任意 session worktree 内可见全部历史。

## 需求

1. launcher 建 worktree 并 cd 后、claude 启动前，建软链 <wt_key> → <main_key>（CLAUDE_PROJECTS_ROOT 可覆盖）。
2. <wt_key> 位置已存在孤儿真实目录 → 内容迁入主仓文件夹后替换为软链；迁移失败保留原目录不建链。
3. 干净退出清理 worktree 的同一分支里删软链（-L 先验，只删链接本身）；脏 worktree 保留时软链保留。
4. 全段 best-effort：任何失败仅 stderr 警告，不阻断 claude 启动。
5. --dry-run 契约：auto-worktree 分支输出含 ln -s 行。

## 成功标准

- claude 运行期内 <wt_key> 是指向 <main_key> 的软链；孤儿目录被迁移合并。
- 干净退出软链删除、主仓池子 transcript 完好；脏退出软链保留。
- --dry-run 输出含 ln -s；headless/逃生阀/已在 worktree 场景行为不变。
```

- [ ] **Step 5: 写 DoD 文件**

`DoD.cp-07061211-resume-history-symlink.md`（条目先写 `[ ]`，Step 7 验证后全部勾 `[x]` 再 push）：

```markdown
# DoD — resume 历史软链回主仓

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/claude-launch.sh` 含 `_path_to_project_key` 与 `_link_projects_dir` 函数
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('_path_to_project_key')||!c.includes('_link_projects_dir'))process.exit(1)"

- [ ] [ARTIFACT] `scripts/claude-launch.sh` 支持 `CLAUDE_PROJECTS_ROOT` 覆盖
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('CLAUDE_PROJECTS_ROOT'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] auto-worktree 启动 → 运行期内 <wt_key> 是指向 <main_key> 的软链
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [ ] [BEHAVIOR] 孤儿真实目录 → 内容迁入主仓文件夹并原位替换为软链
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [ ] [BEHAVIOR] 干净退出 → 软链删除且主仓池子 transcript 完好；脏 worktree 保留 → 软链保留
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [ ] [BEHAVIOR] --dry-run（auto-worktree）→ 输出含 ln -s 契约行
  Test: packages/engine/tests/launcher/claude-launch.test.ts
```

- [ ] **Step 6: 写 learning 文件**

`docs/learnings/cp-07061211-resume-history-symlink.md`：

```markdown
# Learning — resume 历史被 session 隔离打散

### 根本原因

#3557 用 per-session worktree 隔离 cwd 时，没有意识到 Claude Code 的 transcript 存储和
/resume 过滤都以 cwd 派生的 projects key 为单位——隔离 cwd 的同时把会话历史也隔离了，
每个 session 变成孤儿文件夹，/resume 形同虚设。

### 下次预防

- [ ] 改变进程 cwd 的基础设施改动，必须清点所有"以 cwd 为 key"的外部状态
      （Claude Code projects/memory、.dev-lock、hooks 的 cwd 判定），逐个确认不被破坏
- [ ] launcher 类必经路径上的新增逻辑一律 best-effort + stderr 警告，不阻断主流程
```

- [ ] **Step 7: 逐条跑 DoD Test 命令，全过后把所有 `[ ]` 勾成 `[x]`**

Run: DoD 里两条 node -e 原样执行（exit 0 即过）+ `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts`
Expected: 全部通过 → 编辑 DoD 文件勾选。

- [ ] **Step 8: DevGate + Commit**

```bash
node scripts/facts-check.mjs
node packages/engine/scripts/devgate/check-dod-mapping.cjs
git add -A
git commit -m "chore(engine): version bump 19.3.0 -> 19.4.0 + feature-registry changelog + PRD/DoD/learning"
```

Expected: facts-check 通过（本次未改 Brain 代码）；check-dod-mapping 通过（DoD Test 全部映射到存在的测试文件/CI 兼容命令）。

---

## Self-Review 记录

- Spec 覆盖：软链建立/迁移/清理/dry-run/best-effort/沙箱加固 → Task 1-2；工程合规 → Task 3。范围外条目（历史孤儿一次性回填、CI 闸门）确认不在本计划。
- 无占位符；测试与实现的 key 规则一致（`[/.]` → `-`）；`_link_projects_dir`/`_path_to_project_key` 命名全计划一致。
- push 前 DoD 全勾 + ≥1 [BEHAVIOR]（4 条）满足 L1。
