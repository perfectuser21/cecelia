# Session 隔离根治 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交互 claude session 从主仓自动落进独立 per-session worktree，并用 PreToolUse hook 兜底拦截误落回主仓的写操作，根治多 session 共用同一工作树/分支互相踩踏的问题。

**Architecture:** 两层防御。①`scripts/claude-launch.sh`（主力隔离）在交互模式且 cwd 落在主仓工作树时，自动建立或复用 `~/worktrees/<project>/session-<sid8>` worktree（base=`origin/main`），cd 进去再启动 claude；干净退出时自动清理空 worktree。②`packages/engine/hooks/main-repo-write-guard.sh`（backstop）在 PreToolUse 拦截主仓工作树内的 Write/Edit/`git commit`/`git add`，只读操作放行。判主仓用同一个可靠判据：`git rev-parse --git-dir` 与 `--git-common-dir` 是否相等（相等=主仓，不等=某个 linked worktree），两处代码复用同一判据，行为一致。

**Tech Stack:** Bash（launcher + hook），Vitest + `execFileSync`/`execSync`（契约测试，走 mock claude binary + 临时 git repo，不依赖真实 claude 二进制或网络）。

## Global Constraints

- 判主仓工作树的唯一判据：`git rev-parse --git-dir` == `git rev-parse --git-common-dir`（在同一 cwd 下比较两条命令的输出字符串）。两处实现（launcher + hook）必须用完全相同的判据，不允许各写各的。
- headless（参数含 `-p` 或 `--print`）永远不触发自动 worktree——不改动 `cecelia-run.sh` 的既有 worktree 逻辑。
- 逃生阀环境变量名固定为 `CECELIA_NO_AUTO_WORKTREE`（值 `1` 生效）。
- worktree 路径复用 `packages/engine/skills/dev/scripts/worktree-manage.sh` 已有的环境变量约定：`WORKTREE_BASE`（默认 `$HOME/worktrees`）+ `<project_name>`（`basename` 主仓路径）+ `/session-<sid8>`。`sid8` = `CLAUDE_SESSION_ID` 前 8 个字符。分支名与目录名同为 `session-<sid8>`。
- `--dry-run` 契约必须保持：只打印将要执行的命令，不产生任何真实副作用（不 fetch、不 worktree add）。
- 不改动 `cecelia-run.sh`；不新增第二套 worktree reaper；不处理主仓遗留的 untracked 历史文件清理（超出本次范围）。
- 所有新增/修改的 shell 逻辑必须有 Vitest 契约测试覆盖，测试跑在临时目录里的真实 git repo + mock `claude` 二进制上，不依赖网络、不依赖开发者本机真实仓库状态。

---

## File Structure

- Modify: `scripts/claude-launch.sh` — 加自动 worktree 检测/建立/清理逻辑，其余（`--session-id`、账号切换、`CLAUDE_CODE_EXECPATH` 解析）不变。
- Modify: `packages/engine/tests/launcher/claude-launch.test.ts` — 追加 dry-run 契约测试 + 真实建立/清理测试；给既有 3 个测试加 `CECELIA_NO_AUTO_WORKTREE=1` 逃生阀（见 Task 2 背景说明，防止新逻辑意外劫持这些测试的真实 cwd）。
- Create: `packages/engine/hooks/main-repo-write-guard.sh` — 新 PreToolUse hook。
- Create: `packages/engine/tests/hooks/main-repo-write-guard.test.ts` — hook 契约测试。
- Create: `PRD.cp-0705181610-session-isolation.md` / `DoD.cp-0705181610-session-isolation.md` — 本仓库 /dev 流程约定的交付物（repo 根目录，与既有 `PRD.cp-*.md`/`DoD.cp-*.md` 同规格）。

---

### Task 1: `main-repo-write-guard.sh` hook（backstop，先做——独立、无依赖）

**Files:**
- Create: `packages/engine/hooks/main-repo-write-guard.sh`
- Test: `packages/engine/tests/hooks/main-repo-write-guard.test.ts`

**Interfaces:**
- Consumes: 无（独立脚本，Claude Code 通过 stdin JSON 或测试用 `HOOK_INPUT` env var 传入 `{tool_name, cwd, tool_input}`）。
- Produces: exit code 0（放行）或 2 + stdout `{"decision":"block","reason":"..."}`（拦截）。后续无其它任务依赖此文件的内部实现，只依赖它的 exit code 契约。

- [ ] **Step 1: 写测试文件（先写全部失败用例）**

创建 `packages/engine/tests/hooks/main-repo-write-guard.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOOK = path.resolve(__dirname, '../../hooks/main-repo-write-guard.sh');

interface Env {
  base: string;
  mainRepo: string;
  worktree: string;
}

function createEnv(name: string): Env {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `main-repo-guard-${name}-`));
  const mainRepo = path.join(base, 'main');
  fs.mkdirSync(mainRepo, { recursive: true });
  execFileSync('git', ['init', '-q', mainRepo]);
  execFileSync('git', ['-C', mainRepo, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', mainRepo, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(mainRepo, 'README.md'), 'init');
  execFileSync('git', ['-C', mainRepo, 'add', '.']);
  execFileSync('git', ['-C', mainRepo, 'commit', '-q', '-m', 'init']);
  const worktree = path.join(base, 'wt');
  execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', '-b', 'session-test', worktree]);
  return { base, mainRepo, worktree };
}

function destroyEnv(env: Env): void {
  try {
    execFileSync('git', ['-C', env.mainRepo, 'worktree', 'remove', env.worktree, '--force']);
  } catch {
    // ignore
  }
  fs.rmSync(env.base, { recursive: true, force: true });
}

function run(cwd: string, input: Record<string, unknown>): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('/bin/bash', [HOOK], {
      cwd,
      env: { ...process.env, HOOK_INPUT: JSON.stringify(input) },
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    return { exitCode: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

describe('main-repo-write-guard.sh', () => {
  let env: Env;

  beforeAll(() => {
    env = createEnv('basic');
  });

  afterAll(() => {
    destroyEnv(env);
  });

  it('主仓 + Edit → block', () => {
    const r = run(env.mainRepo, { tool_name: 'Edit', cwd: env.mainRepo, tool_input: {} });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain('"decision": "block"');
  });

  it('主仓 + Write → block', () => {
    const r = run(env.mainRepo, { tool_name: 'Write', cwd: env.mainRepo, tool_input: {} });
    expect(r.exitCode).toBe(2);
  });

  it('主仓 + Bash git commit → block', () => {
    const r = run(env.mainRepo, {
      tool_name: 'Bash',
      cwd: env.mainRepo,
      tool_input: { command: 'git commit -m "x"' },
    });
    expect(r.exitCode).toBe(2);
  });

  it('主仓 + Bash git add → block', () => {
    const r = run(env.mainRepo, {
      tool_name: 'Bash',
      cwd: env.mainRepo,
      tool_input: { command: 'git add foo.txt' },
    });
    expect(r.exitCode).toBe(2);
  });

  it('主仓 + 只读 Read → 放行', () => {
    const r = run(env.mainRepo, { tool_name: 'Read', cwd: env.mainRepo, tool_input: {} });
    expect(r.exitCode).toBe(0);
  });

  it('主仓 + Bash git status → 放行', () => {
    const r = run(env.mainRepo, {
      tool_name: 'Bash',
      cwd: env.mainRepo,
      tool_input: { command: 'git status' },
    });
    expect(r.exitCode).toBe(0);
  });

  it('worktree 内 + Edit → 放行', () => {
    const r = run(env.worktree, { tool_name: 'Edit', cwd: env.worktree, tool_input: {} });
    expect(r.exitCode).toBe(0);
  });

  it('worktree 内 + Bash git commit → 放行', () => {
    const r = run(env.worktree, {
      tool_name: 'Bash',
      cwd: env.worktree,
      tool_input: { command: 'git commit -m "x"' },
    });
    expect(r.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试，确认全部失败（文件不存在）**

Run: `cd packages/engine && npx vitest run tests/hooks/main-repo-write-guard.test.ts`
Expected: FAIL — `ENOENT` / 找不到 `packages/engine/hooks/main-repo-write-guard.sh`

- [ ] **Step 3: 写 hook 实现**

创建 `packages/engine/hooks/main-repo-write-guard.sh`：

```bash
#!/usr/bin/env bash
# main-repo-write-guard.sh — PreToolUse hook（backstop）
# 拦主仓工作树内的写操作：Write/Edit 全拦；Bash 只拦 git commit / git add。
# 只读操作、worktree 内任意操作 一律放行。
#
# 主仓判定：git rev-parse --git-dir == git rev-parse --git-common-dir。
# 在 linked worktree 里两者不同（--git-dir 指向 .git/worktrees/<name>，
# --git-common-dir 指向共享的 .git）；在主仓里两者相同。
#
# 入口契约：stdin JSON 传 tool_name / tool_input / cwd（测试用 HOOK_INPUT env
# var 覆盖 stdin，因为 vitest 子进程管道 stdin 不可靠——与仓库其它 hook 测试同套路）。
# 退出码：0 = 放行；2 = block（stdout 输出 decision:block JSON）。
set -uo pipefail

INPUT="${HOOK_INPUT:-$(cat 2>/dev/null || echo '{}')}"

_field() {
    local key="$1"
    echo "$INPUT" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
}

TOOL_NAME="$(_field tool_name)"
CWD="$(_field cwd)"
[[ -z "$CWD" ]] && CWD="$PWD"
[[ ! -d "$CWD" ]] && exit 0

GD="$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)" || exit 0
CMN="$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)" || exit 0
[[ "$GD" != "$CMN" ]] && exit 0   # 在 worktree 里 → 放行

IS_WRITE=0
case "$TOOL_NAME" in
    Write|Edit)
        IS_WRITE=1
        ;;
    Bash)
        CMD="$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
        if echo "$CMD" | grep -qE '\bgit[[:space:]]+(commit|add)\b'; then
            IS_WRITE=1
        fi
        ;;
esac

[[ "$IS_WRITE" != "1" ]] && exit 0

cat <<'EOF'
{
  "decision": "block",
  "reason": "🚫 你在主仓工作树，禁止直接改动。跑 /dev 或 cd 进你的 session worktree（worktrees/<project>/session-<sid>）。"
}
EOF
exit 2
```

赋予可执行权限：

```bash
chmod +x packages/engine/hooks/main-repo-write-guard.sh
```

- [ ] **Step 4: 跑测试，确认全部通过**

Run: `cd packages/engine && npx vitest run tests/hooks/main-repo-write-guard.test.ts`
Expected: PASS（8/8）

- [ ] **Step 5: Commit**

```bash
git add packages/engine/hooks/main-repo-write-guard.sh packages/engine/tests/hooks/main-repo-write-guard.test.ts
git commit -m "feat(engine): 新增 main-repo-write-guard hook — 拦主仓工作树写操作"
```

---

### Task 2: `claude-launch.sh` 自动 worktree 检测 + `--dry-run` 契约

**Files:**
- Modify: `scripts/claude-launch.sh`
- Modify: `packages/engine/tests/launcher/claude-launch.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `_is_headless()`、`_in_main_repo_worktree()` 两个 bash 函数 + `AUTO_WORKTREE`/`SID_SHORT`/`_MAIN_REPO`/`_PROJECT_NAME`/`_WT_BASE`/`_WT_BRANCH`/`_WT_PATH` 变量，供 Task 3 直接复用（Task 3 不重新定义这些变量，只在其基础上加真实建立/清理逻辑）。

**⚠️ 背景说明（为什么要碰 3 个既有测试）：** 现有 3 个测试都不传 `--dry-run` 也不传 `-p`，且不设 `CECELIA_NO_AUTO_WORKTREE`。Vitest 跑测试时的 cwd 通常是一个**普通 clone**（CI 里 `actions/checkout`），不是 linked worktree，`--git-dir` == `--git-common-dir`，会被新逻辑误判成"主仓工作树 + 交互模式"，从而在测试环境里真的尝试 `git worktree add`。这 3 个测试测的是 session-id 透传契约，和 worktree 行为无关，必须显式设 `CECELIA_NO_AUTO_WORKTREE=1` 隔离掉新功能，避免测试环境被意外改写。

- [ ] **Step 1: 更新既有 3 个测试 + 追加新的失败测试**

打开 `packages/engine/tests/launcher/claude-launch.test.ts`，给现有 3 个 `it` 块的 `env` 对象都加一行 `CECELIA_NO_AUTO_WORKTREE: '1'`：

```typescript
  it('有 env 时继承 CLAUDE_SESSION_ID 并传 --session-id', () => {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: 'inherited-test-uuid',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --help`, { shell: '/bin/bash', env }).toString();
    expect(out).toContain('CLAUDE_SESSION_ID=inherited-test-uuid');
    expect(out).toContain('--session-id inherited-test-uuid');
    expect(out).toContain('--help');
  });

  it('无 env 时生成符合 UUID 格式的 session_id', () => {
    const env = { ...process.env, PATH: `${mockDir}:${process.env.PATH}`, CECELIA_NO_AUTO_WORKTREE: '1' };
    delete env.CLAUDE_SESSION_ID;
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --help`, { shell: '/bin/bash', env }).toString();
    const m = out.match(/CLAUDE_SESSION_ID=([a-f0-9-]+)/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(out).toContain(`--session-id ${m![1]}`);
  });

  it('透传额外参数给 claude', () => {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: 'fixed',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" -p test-prompt --dangerously-skip-permissions`, { shell: '/bin/bash', env }).toString();
    expect(out).toContain('-p test-prompt');
    expect(out).toContain('--dangerously-skip-permissions');
    expect(out).toContain('--session-id fixed');
  });
```

在文件末尾（`});` 收尾的 describe 块外）追加新的 describe 块（这些测试此刻全部会失败，因为 `claude-launch.sh` 还没有自动 worktree 逻辑）：

```typescript
describe('Phase 7.7 claude-launch.sh 自动 worktree — --dry-run 契约', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'claude-launch-mainrepo-'));
    execSync('git init -q', { cwd: repoDir });
    execSync('git config user.email test@test.com', { cwd: repoDir });
    execSync('git config user.name Test', { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), 'x');
    execSync('git add . && git commit -q -m init', { cwd: repoDir });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('主仓根 + 交互模式 → dry-run 输出含 worktree 建立步骤', () => {
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: repoDir, env }).toString();
    expect(out).toContain('git worktree add');
  });

  it('headless（-p）→ dry-run 输出不含 worktree 建立步骤', () => {
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run -p "hi"`, { cwd: repoDir, env }).toString();
    expect(out).not.toContain('git worktree add');
  });

  it('CECELIA_NO_AUTO_WORKTREE=1 → dry-run 输出不含 worktree 建立步骤', () => {
    const env: Record<string, string> = {
      ...process.env,
      CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: repoDir, env }).toString();
    expect(out).not.toContain('git worktree add');
  });

  it('cwd 已在 worktree 内 → dry-run 输出不含 worktree 建立步骤', () => {
    const wtDir = join(repoDir, '..', 'precreated-wt');
    execSync(`git worktree add -q -b precreated "${wtDir}"`, { cwd: repoDir });
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: wtDir, env }).toString();
    expect(out).not.toContain('git worktree add');
    execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir });
  });
});
```

- [ ] **Step 2: 跑测试，确认新增测试失败、且没弄坏已改的 3 个既有测试**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts`
Expected: 既有 3 个测试 PASS（加了 `CECELIA_NO_AUTO_WORKTREE=1` 但脚本还没用到这个变量，行为跟改动前一致）；新增 4 个测试 FAIL（`--dry-run` 输出里没有 `git worktree add` 字样）。

- [ ] **Step 3: 修改 `scripts/claude-launch.sh`，加检测逻辑 + dry-run 分支**

用下面的完整内容替换整个文件（在原文件基础上，`--dry-run` 判断块之前插入新函数/变量，`--dry-run` 判断块本身改写；`_CLAUDE_BIN` 解析、账号切换、`FINAL_CMD`/`exec` 部分本步骤先保持原样不动，留给 Task 3 改）：

```bash
#!/usr/bin/env bash
# Cecelia 统一 claude 启动器
# 保证 headless / interactive / parallel 所有 claude 实例都有 --session-id + export 到子进程
# 交互模式下、cwd=主仓工作树时，自动建/复用 per-session worktree，隔离多 session 互踩（session 隔离根治）
# 用法：
#   直接用:     bash scripts/claude-launch.sh [-p PROMPT] [其他 claude 参数]
#   交互 alias:  alias claude='bash /absolute/path/to/scripts/claude-launch.sh'
#   headless:   CLAUDE_SESSION_ID=<uuid> bash scripts/claude-launch.sh -p "..."
#   dry-run:    bash scripts/claude-launch.sh --dry-run  → echo 最终命令行后 exit 0
#   逃生阀:     CECELIA_NO_AUTO_WORKTREE=1 bash scripts/claude-launch.sh  → 不自动建 worktree
set -euo pipefail

SID="${CLAUDE_SESSION_ID:-$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null)}"
export CLAUDE_SESSION_ID="$SID"

# --dry-run 选项：解析参数，提取 --dry-run 标志
DRY_RUN=0
ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--dry-run" ]]; then
        DRY_RUN=1
    else
        ARGS+=("$arg")
    fi
done

# 是否 headless（-p/--print）—— headless 走 cecelia-run.sh 自己的 worktree 逻辑，不自动建 worktree
_is_headless() {
    local a
    for a in ${ARGS[@]+"${ARGS[@]}"}; do
        [[ "$a" == "-p" || "$a" == "--print" ]] && return 0
    done
    return 1
}

# 判断当前 cwd 是否在"主仓工作树"内（非 linked worktree）。
# 主仓：git rev-parse --git-dir == --git-common-dir；worktree 里两者不同
# （--git-dir 指向 .git/worktrees/<name>，--git-common-dir 指向共享 .git）。
_in_main_repo_worktree() {
    local gd cmn
    gd="$(git rev-parse --git-dir 2>/dev/null)" || return 1
    cmn="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    [[ "$gd" == "$cmn" ]]
}

AUTO_WORKTREE=0
if ! _is_headless && [[ "${CECELIA_NO_AUTO_WORKTREE:-0}" != "1" ]] && _in_main_repo_worktree; then
    AUTO_WORKTREE=1
fi

SID_SHORT="${SID:0:8}"
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _MAIN_REPO="$(git rev-parse --show-toplevel)"
    _PROJECT_NAME="$(basename "$_MAIN_REPO")"
    _WT_BASE="${WORKTREE_BASE:-$HOME/worktrees}/${_PROJECT_NAME}"
    _WT_BRANCH="session-${SID_SHORT}"
    _WT_PATH="${_WT_BASE}/${_WT_BRANCH}"
fi

# --dry-run 优先：CI / 测试环境无真 claude binary 也要能跑契约测试
# 输出格式与正常 exec 一致，含 --session-id <uuid>；触发自动 worktree 时额外输出建立步骤
if [[ "$DRY_RUN" == "1" ]]; then
    _CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-$(command -v claude 2>/dev/null || echo claude)}"
    if [[ "$AUTO_WORKTREE" == "1" ]]; then
        echo "git -C \"$_MAIN_REPO\" fetch origin main --quiet"
        echo "git -C \"$_MAIN_REPO\" worktree add \"$_WT_PATH\" -b \"$_WT_BRANCH\" origin/main"
        echo "cd \"$_WT_PATH\""
    fi
    echo "$_CLAUDE_BIN --session-id $SID ${ARGS[@]+${ARGS[@]}}"
    exit 0
fi

# Phase 7.6: 用绝对路径/command 跳过 shell function + alias，避免递归陷阱。
# Claude Code 的 shell-snapshots 会注入 'claude' shell function；在 bash 子进程里
# `exec claude` 会解析成该 function 反复调回 launcher 本身，表现为 "permission
# denied" 或死循环。优先级：CLAUDE_CODE_EXECPATH > PATH 里真 binary。
_CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-}"
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    _CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
fi
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    echo "[claude-launch] ❌ 找不到真 claude 可执行文件（CLAUDE_CODE_EXECPATH/\$PATH 都不行）" >&2
    exit 127
fi

# 账号切换：claude-switch cs/cn 写入 ~/.claude/.active-account-dir
if [[ -z "${CLAUDE_CONFIG_DIR:-}" ]]; then
    _ACCT_DIR_FILE="$HOME/.claude/.active-account-dir"
    if [[ -f "$_ACCT_DIR_FILE" ]]; then
        _ACCT_DIR=$(cat "$_ACCT_DIR_FILE")
        if [[ -d "$_ACCT_DIR" ]]; then
            export CLAUDE_CONFIG_DIR="$_ACCT_DIR"
        fi
    fi
fi

FINAL_CMD=("$_CLAUDE_BIN" --session-id "$SID" "${ARGS[@]+"${ARGS[@]}"}")
exec "${FINAL_CMD[@]}"
```

- [ ] **Step 4: 跑测试，确认全部通过**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts`
Expected: PASS（既有 3 个 + 新增 4 个，共 7 个）

- [ ] **Step 5: Commit**

```bash
git add scripts/claude-launch.sh packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "feat(launcher): claude-launch.sh 加自动 worktree 检测 + --dry-run 契约"
```

---

### Task 3: `claude-launch.sh` 真实建立/复用/退出清理

**Files:**
- Modify: `scripts/claude-launch.sh`
- Modify: `packages/engine/tests/launcher/claude-launch.test.ts`

**Interfaces:**
- Consumes: Task 2 产出的 `AUTO_WORKTREE`/`_MAIN_REPO`/`_PROJECT_NAME`/`_WT_BASE`/`_WT_BRANCH`/`_WT_PATH` 变量、`_is_headless`/`_in_main_repo_worktree` 函数。
- Produces: 无后续任务依赖（这是最后一个改 launcher 的任务）。

- [ ] **Step 1: 追加真实建立 + 清理的失败测试**

在 `packages/engine/tests/launcher/claude-launch.test.ts` 末尾追加：

```typescript
describe('Phase 7.7 claude-launch.sh 自动 worktree — 真实建立与清理', () => {
  let base: string;
  let bareDir: string;
  let mainRepo: string;
  let mockDir: string;
  let worktreeBase: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'claude-launch-real-'));
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
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-mockbin-'));
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

  it('主仓根 + 交互模式 → 建立 session worktree 并 cd 进去执行 claude；干净退出后自动清理', () => {
    writeMockClaude(`#!/usr/bin/env bash\npwd\nexit 0\n`);
    const sid = 'deadbeef-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(out.trim()).toBe(expectedWt);
    expect(existsSync(expectedWt)).toBe(false);
  });

  it('worktree 内有未提交改动 → 退出后保留 worktree', () => {
    writeMockClaude(`#!/usr/bin/env bash\necho dirty > uncommitted.txt\nexit 0\n`);
    const sid = 'cafebabe-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env });
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(existsSync(join(expectedWt, 'uncommitted.txt'))).toBe(true);
  });

  it('同一 session_id 再次启动 → 幂等复用已存在的 worktree（不报错、不重建）', () => {
    writeMockClaude(`#!/usr/bin/env bash\npwd\nexit 0\n`);
    const sid = 'cafebabe-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    // 上一个测试已给这个 sid 留了脏 worktree（含 uncommitted.txt），这里复用它
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(out.trim()).toBe(expectedWt);
    expect(existsSync(join(expectedWt, 'uncommitted.txt'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试，确认新增 3 个测试失败**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts`
Expected: Task 2 的测试仍 PASS；新增 3 个测试 FAIL（此刻 launcher 还是直接 `exec`，不会真的建 worktree，`pwd` 输出的是 `mainRepo` 而非 `expectedWt`）。

- [ ] **Step 3: 实现真实建立 + cd + 非 exec 前台执行 + 退出清理**

把 `scripts/claude-launch.sh` 中「真实执行」部分（从 `_CLAUDE_BIN` 解析注释开始到文件末尾）替换为：

```bash
# 真实执行：交互模式 + 主仓工作树 → 建立/复用 per-session worktree 并 cd 进去
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    mkdir -p "$_WT_BASE"
    if [[ ! -d "$_WT_PATH" ]]; then
        git -C "$_MAIN_REPO" fetch origin main --quiet 2>/dev/null || true
        git -C "$_MAIN_REPO" worktree add "$_WT_PATH" -b "$_WT_BRANCH" origin/main
    fi
    cd "$_WT_PATH"
fi

# Phase 7.6: 用绝对路径/command 跳过 shell function + alias，避免递归陷阱。
# Claude Code 的 shell-snapshots 会注入 'claude' shell function；在 bash 子进程里
# `exec claude` 会解析成该 function 反复调回 launcher 本身，表现为 "permission
# denied" 或死循环。优先级：CLAUDE_CODE_EXECPATH > PATH 里真 binary。
_CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-}"
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    _CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
fi
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    echo "[claude-launch] ❌ 找不到真 claude 可执行文件（CLAUDE_CODE_EXECPATH/\$PATH 都不行）" >&2
    exit 127
fi

# 账号切换：claude-switch cs/cn 写入 ~/.claude/.active-account-dir
if [[ -z "${CLAUDE_CONFIG_DIR:-}" ]]; then
    _ACCT_DIR_FILE="$HOME/.claude/.active-account-dir"
    if [[ -f "$_ACCT_DIR_FILE" ]]; then
        _ACCT_DIR=$(cat "$_ACCT_DIR_FILE")
        if [[ -d "$_ACCT_DIR" ]]; then
            export CLAUDE_CONFIG_DIR="$_ACCT_DIR"
        fi
    fi
fi

FINAL_CMD=("$_CLAUDE_BIN" --session-id "$SID" "${ARGS[@]+"${ARGS[@]}"}")

# 非自动 worktree 路径（headless / 已在 worktree / 逃生阀）：行为完全不变，exec 替换进程
if [[ "$AUTO_WORKTREE" != "1" ]]; then
    exec "${FINAL_CMD[@]}"
fi

# 自动 worktree 路径：不能用 exec —— claude 退出后要跑清理，前台执行 + 保留退出码
set +e
"${FINAL_CMD[@]}"
_CLAUDE_EXIT=$?
set -e

# 干净退出清理：worktree 无未提交改动、无 stash、无相对 origin/main（或 origin/<branch>）的未推送 commit → 移除
_DIRTY=0
[[ -n "$(git -C "$_WT_PATH" status --porcelain 2>/dev/null)" ]] && _DIRTY=1
[[ -n "$(git -C "$_WT_PATH" stash list 2>/dev/null)" ]] && _DIRTY=1
if [[ "$_DIRTY" == "0" ]]; then
    if git -C "$_WT_PATH" rev-parse --verify "origin/${_WT_BRANCH}" &>/dev/null; then
        _UNPUSHED="$(git -C "$_WT_PATH" log "origin/${_WT_BRANCH}..HEAD" --oneline 2>/dev/null)"
    else
        _UNPUSHED="$(git -C "$_WT_PATH" log "origin/main..HEAD" --oneline 2>/dev/null)"
    fi
    if [[ -z "$_UNPUSHED" ]]; then
        git -C "$_MAIN_REPO" worktree remove "$_WT_PATH" --force 2>/dev/null || true
        git -C "$_MAIN_REPO" branch -D "$_WT_BRANCH" 2>/dev/null || true
    fi
fi

exit "$_CLAUDE_EXIT"
```

- [ ] **Step 4: 跑测试，确认全部通过**

Run: `cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts`
Expected: PASS（全部 10 个测试：既有 3 + Task 2 新增 4 + Task 3 新增 3）

- [ ] **Step 5: Commit**

```bash
git add scripts/claude-launch.sh packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "feat(launcher): claude-launch.sh 真实建立/复用/清理 per-session worktree"
```

---

### Task 4: PRD / DoD 交付物（仓库约定，CI DoD 门禁需要）

**Files:**
- Create: `PRD.cp-0705181610-session-isolation.md`
- Create: `DoD.cp-0705181610-session-isolation.md`

**Interfaces:**
- Consumes: Task 1-3 的测试文件路径（作为 DoD 的 Test 引用）。
- Produces: 无（纯文档，供 CI DoD 门禁 + `finishing-a-development-branch` 阶段读取）。

- [ ] **Step 1: 写 `PRD.cp-0705181610-session-isolation.md`**

```markdown
# PRD — session 隔离根治（launcher 自动 worktree + hook 硬拦主仓写）

## 背景

多个交互 claude session 的 cwd 全部落在主仓工作树、共用同一 `cp-*` 分支和 `.dev-lock`，
2026-07-05 上午互相踩踏数小时（改文件冲突、git 状态互踩、抢 docker/DB）。
`claude-launch.sh` 只保证 `--session-id`，完全不隔离工作目录；new branch 只隔离代码历史不隔离 cwd。

## 目标

交互 claude 从主仓启动时自动落进独立 per-session worktree，互不可见；
即便手动 cd 回主仓，PreToolUse hook 也硬拦写操作。

## 需求

1. `claude-launch.sh` 交互模式 + cwd=主仓工作树 → 自动建/复用 `session-<sid8>` worktree（base=origin/main），cd 进去再起 claude。
2. headless（`-p`）、已在 worktree、`CECELIA_NO_AUTO_WORKTREE=1` → 不触发，行为不变。
3. session 干净退出（无未提交改动/stash/未推送 commit）→ 自动清理该 worktree；脏的保留。
4. 新增 `packages/engine/hooks/main-repo-write-guard.sh`：主仓工作树内 Write/Edit/`git commit`/`git add` → block；只读放行；worktree 内放行。
5. `--dry-run` 契约保留：只打印命令不产生副作用。

## 成功标准

- 主仓根 + 交互模式 `--dry-run` 输出含 worktree 建立步骤；headless/已在worktree/逃生阀场景不含。
- 真实执行：建立 session worktree 并 cd 进去；干净退出自动清理；有改动/未推送提交则保留；同 session_id 重复启动幂等复用。
- hook：主仓 Write/Edit/`git commit`/`git add` → block；只读、worktree 内 → 放行。
```

- [ ] **Step 2: 写 `DoD.cp-0705181610-session-isolation.md`**

```markdown
# DoD — session 隔离根治（launcher 自动 worktree + hook 硬拦主仓写）

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/engine/hooks/main-repo-write-guard.sh` 文件存在且可执行
  Test: node -e "require('fs').accessSync('packages/engine/hooks/main-repo-write-guard.sh', require('fs').constants.X_OK)"

- [x] [ARTIFACT] `packages/engine/tests/hooks/main-repo-write-guard.test.ts` 测试文件存在
  Test: node -e "require('fs').accessSync('packages/engine/tests/hooks/main-repo-write-guard.test.ts')"

- [x] [ARTIFACT] `scripts/claude-launch.sh` 含 `_in_main_repo_worktree` 判定函数
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('_in_main_repo_worktree'))process.exit(1)"

- [x] [ARTIFACT] `scripts/claude-launch.sh` 含 `CECELIA_NO_AUTO_WORKTREE` 逃生阀
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('CECELIA_NO_AUTO_WORKTREE'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] 主仓根 + 交互模式 → `--dry-run` 输出含 `git worktree add`
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] headless（-p）/ 已在 worktree / `CECELIA_NO_AUTO_WORKTREE=1` → `--dry-run` 输出不含 `git worktree add`
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 主仓根 + 交互模式（真实执行）→ 建立 session worktree、cd 进去执行、干净退出后自动清理
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] worktree 有未提交改动 → 退出后保留 worktree（不清理）；同 session_id 重启幂等复用
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 主仓 cwd + Edit/Write/`git commit`/`git add` → hook block；只读 → 放行；worktree 内任意操作 → 放行
  Test: packages/engine/tests/hooks/main-repo-write-guard.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add PRD.cp-0705181610-session-isolation.md DoD.cp-0705181610-session-isolation.md
git commit -m "docs(session-isolation): 补 PRD/DoD 交付物"
```

---

## 收尾（不在本 worktree 分支内，PR 合并后单独执行）

以下两步是**本地机器操作**，不产生 git commit（`hooks/` 目录不在 git 追踪范围内，`~/.claude/settings.json` 是用户机器配置，不在仓库里），PR 合并后手动执行一次：

1. **主仓复位到 main**：
   ```bash
   cd /Users/administrator/perfect21/cecelia
   git status   # 先看一眼有没有别人没提交的东西，历史 untracked 文件不用管（不在本次范围）
   git checkout main
   git pull --ff-only
   ```
2. **注册新 hook**（把 `packages/engine/hooks/main-repo-write-guard.sh` 同步到本地 `hooks/` 目录，并在 `~/.claude/settings.json` 的 `PreToolUse` 里追加一条 matcher `Write|Edit|Bash` 指向它，与现有 `branch-protect.sh`/`bash-guard.sh` 同级追加，不替换）。

---

## Self-Review

**Spec coverage：**
- A（launcher 自动 worktree，含跳过条件/幂等/清理/dry-run）→ Task 2 + Task 3 覆盖。
- B（hook 硬拦）→ Task 1 覆盖。
- C（主仓复位）→ 收尾章节（非 git 任务，PR 外执行）。
- 验收标准里的 6 条 → 全部对应到 Task 2/3/1 的具体测试用例。

**Placeholder scan：** 全文无 TBD/待补/"类似 Task N"，每个 Step 都有完整代码或精确命令+预期输出。

**Type/命名一致性：** `_in_main_repo_worktree`/`_is_headless`/`AUTO_WORKTREE`/`_WT_PATH`/`_WT_BRANCH`/`_WT_BASE`/`_MAIN_REPO`/`_PROJECT_NAME` 在 Task 2 定义、Task 3 直接复用，命名前后一致；`CECELIA_NO_AUTO_WORKTREE`/`WORKTREE_BASE` 两处（脚本+文档）拼写一致。
