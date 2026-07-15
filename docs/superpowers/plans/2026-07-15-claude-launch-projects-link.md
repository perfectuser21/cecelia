# claude-launch 会话历史软链修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任何交互式启动的 claude（无论 cwd 在主仓还是在已存在的 worktree 内）都把 project key 软链回主仓池，使 `claude --resume` 能列出全部会话。

**Architecture:** 单文件 bash 脚本 `scripts/claude-launch.sh` 的软链子系统重构：把建链判定从「launcher 自己建的 worktree」解耦为「最终 cwd 是不是 linked worktree」；软链改为只建不删；key 算法与 Claude Code 实测规则对齐；root 由 `CLAUDE_CONFIG_DIR` 派生。

**Tech Stack:** bash（zsh 环境但脚本以 bash 运行）、vitest + execSync 黑盒测试、git worktree

**设计文档：** `docs/superpowers/specs/2026-07-15-claude-launch-projects-link-design.md`（9 条改动的 Before/After 与证据在此，实现前必读）

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `scripts/claude-launch.sh` | 唯一实现文件。改动集中在 `_path_to_project_key`(72)、`AUTO_WORKTREE` 门禁(74-77)、dry-run 段(88-104)、`_link_projects_dir`(132-164)、账号解析段(179-192)、清理段(207-225) | Modify |
| `packages/engine/tests/launcher/claude-launch.test.ts` | 唯一测试文件。`describe('resume 历史软链')` 块（273-460）承载全部软链契约 | Modify |

> 不新建文件。软链逻辑内聚在 launcher 单文件里是既有约定（launcher 必须可被 `bash <path>` 单独调用，不能依赖外部 source）。

---

## ⚠️ 全局铁律（每个 Task 都适用）

1. **TDD 两段式 commit**：`commit-1` = failing test（红），`commit-2` = 实现（绿）。CI 有 `lint-tdd-commit-order` 机械闸，src 先于 test 出现即红。
2. **best-effort**：建链失败只 `>&2` 告警 + 继续，**绝不 `exit 1` 阻断 claude 启动**。既有 446 行用例盯着这条。
3. **stdout 只属于 claude 本体**：新增的 `git rev-parse` 等一律 `2>/dev/null`，不得往 stdout 吐。唯一例外是 dry-run 段（它本就输出契约后 `exit 0`）。
4. **macOS 无 `flock(1)`**：任何锁必须 mkdir fallback。
5. 每个 Task 跑测试的命令统一为：
   ```bash
   cd /Users/administrator/worktrees/cecelia/fix-slot-session-orphan-key
   npx vitest run packages/engine/tests/launcher/claude-launch.test.ts
   ```

---

### Task 1: key 算法与 Claude Code 对齐

**Files:**
- Modify: `scripts/claude-launch.sh:71-72`
- Modify: `packages/engine/tests/launcher/claude-launch.test.ts:335`（`toKey` 助手）
- Test: `packages/engine/tests/launcher/claude-launch.test.ts`

**背景（必读）：** 探针实证 —— cwd `/private/tmp/keyprobe/key_Probe.Test A/sub_dir` 对应 claude 真实 key `-private-tmp-keyprobe-key-Probe-Test-A-sub-dir`。规则 = 每个非字母数字字符各换一个 `-`，大小写与数字保留，逐字符不合并。现算法只换 `/` 和 `.`。

> ⚠️ 测试里的 `toKey` 助手（335 行）**也写着错算法**。若只改脚本不改它，测试会用错误期望验证错误实现 —— 两边一起错，CI 照样绿。必须同步翻。

- [ ] **Step 1: 写 failing test**

在 `describe('resume 历史软链 …')` 块内、`makeEnv` 定义之后新增：

```ts
  it('key 算法：非字母数字字符（_ / 空格 / .）逐字符换 -，大小写保留', () => {
    const sid = 'aaaa0007-1111-2222-3333-444444444444';
    // 造一个含下划线 + 空格 + 大写的 worktree 名，走 dry-run 读契约行
    const oddBase = join(base, 'odd_Base Dir');
    mkdirSync(oddBase, { recursive: true });
    const env = { ...makeEnv(sid), WORKTREE_BASE: oddBase };
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    const oddBasePhys = realpathSync(oddBase);
    const wtPath = join(oddBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    // 期望：_ 和空格都变成 -，大写保留
    expect(out).toContain(toKey(wtPath));
    expect(toKey(wtPath)).not.toContain('_');
    expect(toKey(wtPath)).not.toContain(' ');
    expect(toKey(wtPath)).toContain('Base');   // 大写保留
  });
```

同时把 335 行的 `toKey` 助手翻成正确算法：

```ts
  // Before
  const toKey = (p: string): string => p.replace(/[/.]/g, '-');
  // After（与 Claude Code 实测规则一致：非字母数字逐字符换 -，大小写数字保留）
  const toKey = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, '-');
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t 'key 算法'`
Expected: FAIL —— 脚本输出的 key 仍含 `_` 和空格，与 `toKey` 的新期望不符。

> 注：翻 `toKey` 后，`auto-worktree 启动 → …软链`、`--dry-run …ln -s 契约行` 等既有用例**可能一并转红**（它们用 toKey 算期望）。这是预期的：它们本就该按正确算法断言。Task 1 的实现步骤会把它们一起转绿。

- [ ] **Step 3: commit-1（只提交测试）**

```bash
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test: key 算法须与 Claude Code 实测规则一致（非字母数字逐字符换 -）

探针实证：cwd /private/tmp/keyprobe/key_Probe.Test A/sub_dir
→ claude key -private-tmp-keyprobe-key-Probe-Test-A-sub-dir

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: 写实现**

`scripts/claude-launch.sh:71-72`：

```bash
# Before
# Claude Code projects key：绝对路径中 / 和 . 逐字符替换为 -（纯 bash，免 fork）
_path_to_project_key() { printf '%s' "${1//[\/.]/-}"; }

# After
# Claude Code projects key：绝对路径中**每个非字母数字字符**各替换为一个 -，
# 大小写与数字原样保留，逐字符替换不合并连续分隔符（纯 bash，免 fork）。
# 探针实证（2026-07-15）：
#   cwd /private/tmp/keyprobe/key_Probe.Test A/sub_dir
#   → -private-tmp-keyprobe-key-Probe-Test-A-sub-dir
# 旧实现只换 / 和 .，路径一旦含 _ / 空格，链名与 Claude 真实 key 对不上 → 链指空，
# 症状与"会话丢失"完全一致且极难归因。
_path_to_project_key() { printf '%s' "${1//[^a-zA-Z0-9]/-}"; }
```

- [ ] **Step 5: 跑测试确认绿**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`
Expected: 全部 PASS（含被 toKey 影响的既有用例）

- [ ] **Step 6: commit-2（只提交实现）**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): key 算法对齐 Claude Code——非字母数字逐字符换 -

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: root 与 Claude Code 同源（CLAUDE_CONFIG_DIR 派生）

**Files:**
- Modify: `scripts/claude-launch.sh:96`（dry-run 段）、`:137`（`_link_projects_dir`）、`:179-192`（账号解析段，整段上移）
- Test: `packages/engine/tests/launcher/claude-launch.test.ts`

**背景（必读）：** strings 实证 —— claude 二进制里 `CLAUDE_PROJECTS_ROOT` **0 命中**、`CLAUDE_CONFIG_DIR` **24 命中**。前者是只有测试认的假旋钮。生产没炸只因 `~/.claude-account{1,2,3}/projects` 都软链到 `~/.claude/projects`（手工设置，代码无保障）。

**决策（本计划新增，设计文档未覆盖）：** **保留** `CLAUDE_PROJECTS_ROOT` 作测试专用注入（优先级最高），生产由 `CLAUDE_CONFIG_DIR` 派生。原因：交互模式下账号解析段会用 `.active-account-dir` **覆盖** `CLAUDE_CONFIG_DIR`，测试若改用它注入会被冲掉，除非连 `HOME` 一起改——churn 大且脆。折中方案是保留旋钮但注明「仅测试」，另加一条用例盯死生产派生路径。

**顺序要求：** 账号解析段（179-192）当前在软链（162）**之后**，必须整段上移到 **dry-run 段（88 行）之前**，让 dry-run 与真实执行看到同一个 root。上移不改变其语义（依赖的 `_is_headless` 在 42 行已定义）。

- [ ] **Step 1: 写 failing test**

```ts
  it('生产路径：未设 CLAUDE_PROJECTS_ROOT 时 root 由 CLAUDE_CONFIG_DIR 派生', () => {
    const sid = 'aaaa0008-1111-2222-3333-444444444444';
    const fakeHome = mkdtempSync(join(tmpdir(), 'claude-launch-home-'));
    const acctDir = join(fakeHome, '.claude-acctX');
    mkdirSync(join(acctDir, 'projects'), { recursive: true });
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    // 不写 .active-account-dir → 账号解析段不覆盖，显式 CLAUDE_CONFIG_DIR 生效
    const env = { ...makeEnv(sid), HOME: fakeHome, CLAUDE_CONFIG_DIR: acctDir };
    delete env.CLAUDE_PROJECTS_ROOT;   // 关键：拔掉测试旋钮，逼它走生产派生
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    expect(out).toContain(join(acctDir, 'projects'));
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t 'root 由 CLAUDE_CONFIG_DIR 派生'`
Expected: FAIL —— 现实现回退 `$HOME/.claude/projects`，输出不含 `acctDir/projects`。

- [ ] **Step 3: commit-1（只提交测试）**

```bash
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test: projects root 生产路径须由 CLAUDE_CONFIG_DIR 派生

strings 实证：claude 二进制 CLAUDE_PROJECTS_ROOT 0 命中 / CLAUDE_CONFIG_DIR 24 命中

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: 写实现**

4a. 把 179-192 的账号解析段**整段剪切**，粘贴到 88 行 `# --dry-run 优先` 注释**之前**，并加注释说明为何必须早于软链：

```bash
# 账号切换必须早于 projects 软链与 dry-run：软链的 root 由 CLAUDE_CONFIG_DIR 派生
#（Claude Code 只认这个变量），解析晚于建链会把链建到错误账号池。
```

4b. 新增 root 求解 helper（放在 `_path_to_project_key` 之后）：

```bash
# projects 池根目录。CLAUDE_PROJECTS_ROOT **仅供测试注入**——Claude Code 本体不读它
#（strings 实证 0 命中），生产必须由 CLAUDE_CONFIG_DIR 派生，与 claude 本体同源，
# 杜绝"测试绿、生产错"。
_proj_root() { printf '%s' "${CLAUDE_PROJECTS_ROOT:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects}"; }
```

4c. 把 96 行与 137 行的两处 `"${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"` 全部替换为 `"$(_proj_root)"`。

- [ ] **Step 5: 跑测试确认绿**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`
Expected: 全部 PASS（含既有账号切换用例 295/310 行）

- [ ] **Step 6: commit-2（只提交实现）**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): projects root 改由 CLAUDE_CONFIG_DIR 派生 + 账号解析上移

CLAUDE_PROJECTS_ROOT 降级为测试专用旋钮（claude 本体不读）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 解耦门禁（核心修复）+ dry-run 契约同步

**Files:**
- Modify: `scripts/claude-launch.sh:88-104`（dry-run 段）、`:132-164`（`_link_projects_dir`）、`:162-164`（调用点）
- Test: `packages/engine/tests/launcher/claude-launch.test.ts`

**背景（必读）：** 这是根因。`_link_projects_dir` 只在 `AUTO_WORKTREE=1` 时跑，而该门禁要求 cwd 在主仓。从已存在的 worktree 内启动 → 不建链 → 孤儿。生产实证：`e2d67c75` 的 key = `-Users-administrator-worktrees-zenithjoy-session-9cc9a05b`。

**收敛表（设计文档「放置时机」节）：**

| 启动场景 | cd 后 cwd | `! _in_main_repo_worktree` | 结果 |
|---|---|---|---|
| 主仓 + 交互 | 新建 worktree | true | 建链 ✅ |
| **已存在 worktree 内 + 交互** | 该 worktree | true | 建链 ✅ **（修复点）** |
| 主仓 + `CECELIA_NO_AUTO_WORKTREE=1` | 主仓 | false | 不建链（key 即主仓 key）✅ |
| headless `-p` | 任意 | —— | 短路不建链 ✅ |

> 逃生阀 `CECELIA_NO_AUTO_WORKTREE=1` 只管「不自动建 worktree」，**不参与建链判定**——否则它会变成新的丢会话入口。

- [ ] **Step 1: 写 failing test**

```ts
  it('cwd 已在外部建的 worktree 内 → dry-run 仍输出 ln -s 契约行（根因回归）', () => {
    const sid = 'aaaa0009-1111-2222-3333-444444444444';
    // 模拟 slot 场景：worktree 由外部（非 launcher）建好，claude 从其内部启动
    const extWt = join(base, 'external-wt');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt}" -b ext-branch`, { stdio: 'ignore' });
    const extWtPhys = realpathSync(extWt);
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: extWt, env: makeEnv(sid) }).toString();
    expect(out).toContain('ln -s');
    expect(out).toContain(toKey(extWtPhys));           // link = 该 worktree 的 key
    expect(out).toContain(toKey(mainRepoPhys));        // target = 主仓 key
    // 不得新建 worktree（已在 worktree 内）
    expect(out).not.toContain('worktree add');
  });

  it('headless（-p）在 worktree 内 → 仍不建链（机器人会话不灌主池）', () => {
    const sid = 'aaaa0010-1111-2222-3333-444444444444';
    const extWt2 = join(base, 'external-wt2');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt2}" -b ext-branch2`, { stdio: 'ignore' });
    const out = execSync(`bash "${LAUNCHER}" -p hi --dry-run`, { cwd: extWt2, env: makeEnv(sid) }).toString();
    expect(out).not.toContain('ln -s');
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t '外部建的 worktree'`
Expected: FAIL —— 输出不含 `ln -s`（`AUTO_WORKTREE=0` 时 dry-run 只打印 claude 命令行）。这条红**就是本 bug 的复现**。

- [ ] **Step 3: commit-1（只提交测试）**

```bash
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test: worktree 内启动须建软链（会话落孤儿 key 根因回归）

生产实证：会话 e2d67c75 的 project key = …-worktrees-zenithjoy-session-9cc9a05b
即启动时 cwd 在该 worktree，软链未建 → 主仓 --resume 找不到

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: 写实现**

4a. 新增主仓正向求解 helper（放在 `_in_main_repo_worktree` 之后）：

```bash
# 主仓物理路径正向求出（在 linked worktree 内也有效）：
#   主仓：      git-dir == git-common-dir
#   linked wt： git-dir = <main>/.git/worktrees/<n>，git-common-dir = <main>/.git
# 判据与 packages/engine/hooks/main-repo-write-guard.sh 一致（cp-07051816 教训）。
# 绝不反推 project key —— key 是有损多对一映射（/ . 和原生 - 全塌成 -），
# 反推会把 zenithjoy-skills 的历史并进 zenithjoy 主池。
_resolve_main_repo() {
    local cmn
    cmn="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    cmn="$(cd "$cmn" 2>/dev/null && pwd -P)" || return 1
    dirname "$cmn"
}
```

4b. `_link_projects_dir` 改为按**当前 cwd** 自解，不再读 `$_WT_PATH` / `$_MAIN_REPO`：

```bash
_link_projects_dir() {
    local wt_phys main_repo root target link f
    wt_phys="$(pwd -P)" || return 1
    main_repo="$(_resolve_main_repo)" || return 1
    root="$(_proj_root)"
    target="$root/$(_path_to_project_key "$main_repo")"
    link="$root/$(_path_to_project_key "$wt_phys")"
    # 自指短路：link == target 时 ln -s X X 成环，/resume 遍历会 ELOOP
    [[ "$link" == "$target" ]] && return 0
    mkdir -p "$target" || return 1
    ... （原 143-158 行的三分支逻辑保留，Task 5/6 再加固）
    _PROJ_LINK_CREATED="$link"
}
```

4c. 调用点（原 162-164）改为按最终 cwd 判定，**必须放在 `cd "$_WT_PATH"`（129 行）之后**：

```bash
# Before
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _link_projects_dir || echo "[claude-launch] ⚠️ projects 软链失败，本 session 历史将不共享（不影响启动）" >&2
fi

# After
# 交互模式 + cwd 是 linked worktree → 建链，无论该 worktree 是 launcher 建的还是外部建的。
# 逃生阀 CECELIA_NO_AUTO_WORKTREE 只管"不建 worktree"，不参与建链判定。
if ! _is_headless && ! _in_main_repo_worktree; then
    _link_projects_dir || echo "[claude-launch] ⚠️ projects 软链失败，本 session 历史将不共享（不影响启动）" >&2
fi
```

4d. dry-run 段（88-104）同步：auto-worktree 分支保留现有输出；新增「已在 worktree 内」分支也打印 `ln -s` 契约行：

```bash
if [[ "$DRY_RUN" == "1" ]]; then
    _CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-$(command -v claude 2>/dev/null || echo claude)}"
    if [[ "$AUTO_WORKTREE" == "1" ]]; then
        ... 现有 worktree add / cd 输出 ...
        _WT_PHYS="$(cd "$_WT_PATH" 2>/dev/null && pwd -P)" || _WT_PHYS="$_WT_PATH"
        echo "ln -s \"$(_proj_root)/$(_path_to_project_key "$_MAIN_REPO")\" \"$(_proj_root)/$(_path_to_project_key "$_WT_PHYS")\""
    elif ! _is_headless && ! _in_main_repo_worktree; then
        # 已在外部建的 worktree 内：key 按当前 cwd 派生
        _DR_MAIN="$(_resolve_main_repo)" && \
          echo "ln -s \"$(_proj_root)/$(_path_to_project_key "$_DR_MAIN")\" \"$(_proj_root)/$(_path_to_project_key "$(pwd -P)")\""
    fi
    echo "$_CLAUDE_BIN --session-id $SID ${ARGS[@]+${ARGS[@]}}"
    exit 0
fi
```

- [ ] **Step 5: 跑测试确认绿**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`
Expected: 全部 PASS。特别确认既有用例 `cwd 已在 worktree 内 → dry-run 输出不含 worktree 建立步骤`（116 行）**仍绿**——它断言的是不建 worktree，与建链不冲突。

- [ ] **Step 6: commit-2（只提交实现）**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): 解耦软链门禁——按最终 cwd 判定，worktree 内启动也建链

根因：_link_projects_dir 挂在 AUTO_WORKTREE=1 门禁下（要求 cwd 在主仓），
slot 复用 worktree 起 claude 时软链不执行 → 历史落孤儿 key → --resume 找不到

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 软链只建不删（含改判既有用例 411）

**Files:**
- Modify: `scripts/claude-launch.sh:220-223`（清理段删链，整段删除）
- Modify: `packages/engine/tests/launcher/claude-launch.test.ts:411-423`（既有用例改判）

**背景（必读）：** 软链是 **per-worktree-path 的共享资源**，不是 per-session 私有资源 —— 生产实证同一 key 压过 4 条会话（`9cc9a05b`/`26f662f5`/`cee71334`/`e2d67c75`）。第一个会话干净退出删掉共享链后，仍在用该 key 的会话再写就重建成真目录 = 新孤儿。Task 3 会**放大**此缺陷（建链者变多，删链责任仍只在一处，删的还是别人的链），故必须同刀落地。

> 既有用例 411「干净退出 → 软链被删除」把 bug 写成了预期行为，随本 Task 一起翻。这是**有意的测试改判**，不是为了让测试通过而删测试：断言从「链被删」翻成「链保留 + transcript 完好」，覆盖面不减反增。

- [ ] **Step 1: 改判既有用例（这就是本 Task 的 failing test）**

```ts
  // Before（411 行）：'干净退出 → 软链被删除，经软链写入主仓文件夹的 transcript 完好'
  //   expect(existsSync(link)).toBe(false);
  //   expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();

  // After
  it('干净退出 → 软链保留（共享资源，不随单个会话销毁），transcript 完好', () => {
    const sid = 'aaaa0003-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    writeMockClaude(`#!/usr/bin/env bash
echo '{"x":1}' > "${link}/${sid}.jsonl"
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    // 软链是 per-worktree-path 共享资源：同一 key 可压多条会话，
    // 删它会让仍在用该 key 的会话重建真目录 = 新孤儿。8 字节，留着零成本。
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), `${sid}.jsonl`))).toBe(true);
  });

  it('同一 worktree key 多会话共用 → 前一个会话干净退出后，软链对后一个仍有效', () => {
    const sidA = 'aaaa0011-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sidA.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    // 会话 A：干净退出（触发清理段）
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sidA) });
    // 会话 B：复用同一 key 写入 → 必须仍落进主仓池，而不是重建真目录
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    writeFileSync(join(link, 'second-session.jsonl'), '{"y":2}\n');
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), 'second-session.jsonl'))).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t '多会话共用'`
Expected: FAIL —— 清理段已把链删掉，`lstatSync(link)` 抛 ENOENT。

- [ ] **Step 3: commit-1（只提交测试）**

```bash
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test: 软链是 per-worktree 共享资源，干净退出不得删除

改判既有用例 411：同一 key 生产实证压过 4 条会话
（9cc9a05b/26f662f5/cee71334/e2d67c75），删共享链会让后续会话重建真目录=新孤儿

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: 写实现** —— 删除 220-223 整段：

```bash
# Before
        # 只删软链本身（-L 先验），绝不跟随进主仓文件夹；路径复用建链时存的变量
        if [[ -n "${_PROJ_LINK_CREATED:-}" && -L "$_PROJ_LINK_CREATED" ]]; then
            rm "$_PROJ_LINK_CREATED" 2>/dev/null || true
        fi

# After —— 整段删除，替换为注释
        # 软链**不删**：它是 per-worktree-path 的共享资源（同一 key 可压多条会话），
        # 不是 per-session 私有资源。删它会让仍在用该 key 的会话重建真目录 = 新孤儿。
        # 一个软链 8 字节，留着零成本；要回收另跑 GC，不在会话退出路径上做。
```

- [ ] **Step 5: 跑测试确认绿**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`
Expected: 全部 PASS（含 425 行「脏 worktree 保留 → 软链同步保留」）

- [ ] **Step 6: commit-2（只提交实现）**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): 软链只建不删——共享资源不随单个会话销毁

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 安全护栏（`_is_real_dir` / `ln -sfn` / `pwd -P` 硬失败）

**Files:**
- Modify: `scripts/claude-launch.sh`（`_link_projects_dir` 内）

**背景（必读）：** `-d` 对「指向目录的软链」**也为真**。现有代码靠 143 行先判 `-L` 才轮到 148 行 `elif [[ -d ]]` 侥幸活着 —— 这是顺序耦合的隐式不变量，没有注释保护。一旦后来者写出 `if [[ -d "$link" ]]` 而漏了 `-L`，遍历的就是主池上百条真实会话，然后把它们全 `mv` 走 —— 全场最大灾难面。

- [ ] **Step 1: 写 failing test**

```ts
  it('link 已是指向目录的软链 → 不得把新链建到 link/ 内部（ln -sfn 语义）', () => {
    const sid = 'aaaa0012-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    const target = join(projectsRoot, toKey(mainRepoPhys));
    mkdirSync(target, { recursive: true });
    // 预置一条指向"别处"的旧软链，模拟复用/竞态残留
    const decoy = join(projectsRoot, 'decoy-dir');
    mkdirSync(decoy, { recursive: true });
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(decoy, link);
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    // 必须原位改指 target，而不是在 decoy/ 里生出一个嵌套链
    expect(readlinkSync(link)).toBe(target);
    expect(existsSync(join(decoy, toKey(mainRepoPhys)))).toBe(false);
  });
```

> 需在测试文件顶部 import 补 `symlinkSync`, `readlinkSync`, `dirname`。

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t 'ln -sfn 语义'`
Expected: FAIL 或行为不确定 —— 现有 143-147 行虽 `rm` 后重建，但无 `-n` 保护，且 `readlink` 比对可能不符。

- [ ] **Step 3: commit-1** —— 同前，只提交测试文件。

- [ ] **Step 4: 写实现**

```bash
# 新增 helper（放在 _path_to_project_key 附近）
# -d 对"指向目录的软链"也为真 → 判"真目录"必须 -L 先验。漏判会把主池上百条
# 真实会话当孤儿搬走，是本子系统最大灾难面。禁止裸用 [[ -d ]] 判真目录。
_is_real_dir() { [[ -d "$1" && ! -L "$1" ]]; }

# _link_projects_dir 内：
# 1) pwd -P 硬失败（不回退逻辑路径——回退会算出对不上的 key，建出死链，比不建更坏）
wt_phys="$(pwd -P)" || return 1
# 2) 三分支改用 _is_real_dir + ln -sfn（-n：macOS 下不跟随已存在的目录软链）
if [[ -L "$link" ]]; then
    [[ "$(readlink "$link")" == "$target" ]] || ln -sfn "$target" "$link" || return 1
elif _is_real_dir "$link"; then
    ... Task 6 的并回逻辑 ...
else
    ln -sfn "$target" "$link" || return 1
fi
```

- [ ] **Step 5: 跑测试确认绿** —— `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`

- [ ] **Step 6: commit-2**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): 软链安全护栏——_is_real_dir 强制 -L 先验 + ln -sfn + pwd -P 硬失败

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 孤儿真目录并回不覆盖（冲突改名 + 告警）

**Files:**
- Modify: `scripts/claude-launch.sh`（`_link_projects_dir` 的孤儿并回分支，原 148-158）

**背景（必读）：** 现有 152 行 `mv "$f" "$target/" || return 1` —— 同名文件**无条件覆盖**主池那份真实历史，无备份无告警。反向用 `--ignore-existing` 则静默丢弃 worktree 侧那份（往往更新）。**两个方向都丢数据**，必须改名保留。

另：现有 `rmdir`（154 行）只在目录全空时成功。macOS 上一旦 Finder 访问过 projects 子目录生成 `.DS_Store`，`rmdir` 必失败 → `return 1` → 内容已搬走但链没建 → 每次启动重复失败、永远建不上链。实测当前 `find ~/.claude/projects -maxdepth 2 -name .DS_Store` 为空（未触发），但须防。

- [ ] **Step 1: 写 failing test**

```ts
  it('孤儿真目录与主池同名 → 不覆盖，冲突改名保留 + stderr 告警', () => {
    const sid = 'aaaa0013-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const orphanDir = join(projectsRoot, toKey(wtPathPhys));
    const target = join(projectsRoot, toKey(mainRepoPhys));
    mkdirSync(orphanDir, { recursive: true });
    mkdirSync(target, { recursive: true });
    // 主池已有同名文件（内容 A），孤儿目录里同名（内容 B）
    writeFileSync(join(target, 'dup.jsonl'), 'MAIN_POOL_ORIGINAL\n');
    writeFileSync(join(orphanDir, 'dup.jsonl'), 'ORPHAN_VERSION\n');
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    const res = spawnSync('bash', [LAUNCHER], { cwd: mainRepo, env: makeEnv(sid), encoding: 'utf8' });
    // 主池那份绝不能被覆盖
    expect(readFileSync(join(target, 'dup.jsonl'), 'utf8')).toBe('MAIN_POOL_ORIGINAL\n');
    // 孤儿那份必须改名保留，不得静默丢弃
    const kept = readdirSync(target).filter((f) => f.startsWith('dup.jsonl.orphan-'));
    expect(kept.length).toBe(1);
    expect(readFileSync(join(target, kept[0]), 'utf8')).toBe('ORPHAN_VERSION\n');
    // 必须显式告警
    expect(res.stderr).toContain('会话冲突');
  });

  it('孤儿目录残留 .DS_Store → 仍能建成软链（rmdir 不得因垃圾文件卡死）', () => {
    const sid = 'aaaa0014-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const orphanDir = join(projectsRoot, toKey(wtPathPhys));
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, '.DS_Store'), 'junk');
    writeFileSync(join(orphanDir, 'real.jsonl'), '{"z":3}\n');
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(lstatSync(orphanDir).isSymbolicLink()).toBe(true);
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), 'real.jsonl'))).toBe(true);
  });
```

> 需 import 补 `spawnSync`, `readFileSync`, `readdirSync`。

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t '孤儿'`
Expected: 第一条 FAIL（主池被覆盖成 `ORPHAN_VERSION`）；第二条 FAIL（`.DS_Store` 让 rmdir 失败 → 未建链）。

- [ ] **Step 3: commit-1** —— 只提交测试文件。

- [ ] **Step 4: 写实现** —— 替换原 148-158 分支：

```bash
elif _is_real_dir "$link"; then
    # 孤儿真目录：内容并回主池后原位换成软链。
    # 冲突绝不覆盖（会丢主池历史）也绝不静默跳过（会丢 worktree 侧、往往更新的那份），
    # 一律改名保留 + 显式告警，让人能事后归并。
    local base_f ts
    shopt -s dotglob nullglob 2>/dev/null || setopt dotglob nullglob 2>/dev/null || true
    for f in "$link"/*; do
        [[ -e "$f" ]] || continue
        base_f="$(basename "$f")"
        # macOS 垃圾文件直接丢，否则 rmdir 永远失败 → 每次启动重复失败、永远建不上链
        if [[ "$base_f" == ".DS_Store" ]]; then rm -f "$f"; continue; fi
        if [[ -e "$target/$base_f" ]]; then
            ts="$(date +%s)"
            mv -n "$f" "$target/${base_f}.orphan-${ts}" || return 1
            echo "[claude-launch] ⚠️ 会话冲突，已改名保留：${base_f} → ${base_f}.orphan-${ts}" >&2
        else
            mv -n "$f" "$target/" || return 1
        fi
    done
    rmdir "$link" || return 1
    ln -sfn "$target" "$link" || return 1
```

- [ ] **Step 5: 跑测试确认绿** —— `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`

- [ ] **Step 6: commit-2**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): 孤儿并回不覆盖——冲突改名保留 + 告警，.DS_Store 不卡 rmdir

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 并发锁

**Files:**
- Modify: `scripts/claude-launch.sh`（`_link_projects_dir` 外层）
- Reference: `scripts/quickcheck.sh:14-35`（flock + mkdir 双路范式，**照抄其风格**）

**背景（必读）：** 两个 slot 同时启动、同时命中孤儿并回分支时：A 正在 `mv "$link"/*`，B 判 `_is_real_dir` 也为真进入循环 → glob 已展开但文件被 A 移走 → `mv` 报错 → `return 1` → **B 放弃建链，全程写真目录 = 新孤儿**。竞争边界在 **projects 池**（多 repo 共用一个池），不在 git-dir。

**macOS 无 `flock(1)`** —— 必须 mkdir fallback。

- [ ] **Step 1: 写 failing test**

```ts
  it('并发建链：两个进程同时启动同一 key → 不互相踩崩，最终是有效软链', () => {
    const sid = 'aaaa0015-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    const orphanDir = link;
    mkdirSync(orphanDir, { recursive: true });
    for (let i = 0; i < 30; i++) writeFileSync(join(orphanDir, `s${i}.jsonl`), `{"i":${i}}\n`);
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    // 同时起两个
    const envA = makeEnv(sid);
    const p1 = spawnSync('bash', ['-c', `bash "${LAUNCHER}" & bash "${LAUNCHER}" & wait`], {
      cwd: mainRepo, env: envA, encoding: 'utf8',
    });
    expect(p1.status).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(projectsRoot, toKey(mainRepoPhys)));
    // 30 条会话一条都不能丢
    for (let i = 0; i < 30; i++) {
      expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), `s${i}.jsonl`))).toBe(true);
    }
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t '并发建链'`
Expected: FAIL（不稳定复现也算红：其中一个进程 `mv` 撞空 → return 1 → 链没建或文件丢失）。若首次侥幸通过，把 30 调到 200 增大窗口。

- [ ] **Step 3: commit-1** —— 只提交测试文件。

- [ ] **Step 4: 写实现** —— 在 `_link_projects_dir` 外层包锁：

```bash
# 建链锁：竞争边界是 projects 池（多 repo 共用一池），不是 git-dir。
# macOS 无 flock(1) → mkdir 原子锁兜底（范式抄 scripts/quickcheck.sh:14-35）。
# best-effort：拿不到锁只告警跳过建链，绝不阻断 claude 启动。
_with_link_lock() {
    local root lockdir tries=0
    root="$(_proj_root)"
    mkdir -p "$root" 2>/dev/null || return 1
    lockdir="$root/.link.lockdir"
    until mkdir "$lockdir" 2>/dev/null; do
        tries=$((tries + 1))
        if (( tries > 50 )); then           # ~5s
            # stale 锁自愈：超过 60s 的锁视为死锁残留
            if [[ -d "$lockdir" ]] && [[ -n "$(find "$lockdir" -maxdepth 0 -mmin +1 2>/dev/null)" ]]; then
                rm -rf "$lockdir" 2>/dev/null || true
                continue
            fi
            echo "[claude-launch] ⚠️ projects 建链锁超时，跳过（不影响启动）" >&2
            return 1
        fi
        sleep 0.1
    done
    # trap 只在本函数作用域内保证释放；claude 尚未 exec，不存在 FD 泄漏问题
    # （不用 flock 的 FD 正是为了避开 worktree-manage.sh:288 记录的子进程继承持锁坑）
    _link_projects_dir; local rc=$?
    rmdir "$lockdir" 2>/dev/null || true
    return $rc
}
```

调用点改为 `_with_link_lock || echo "..." >&2`。

- [ ] **Step 5: 跑测试确认绿** —— 连跑 3 次确认不 flaky：

```bash
for i in 1 2 3; do npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t '并发建链' || break; done
```

- [ ] **Step 6: commit-2**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(launcher): 建链加 mkdir 原子锁（macOS 无 flock）+ stale 自愈

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: proven-to-fire 验收 + 全量回归

**Files:** 无改动，纯验证。

**背景（必读）：** 「没见过它报红的守卫不算守卫」。前 7 个 Task 的 commit-1 已各自见过红，本 Task 做总验收。

- [ ] **Step 1: 全量跑 launcher 测试**

Run: `npx vitest run packages/engine/tests/launcher/claude-launch.test.ts`
Expected: 全部 PASS，0 skipped。

- [ ] **Step 2: 核心守卫 proven-to-fire 复验**

把 Task 3 的修复临时改回（门禁加回 `AUTO_WORKTREE`），确认核心用例转红：

```bash
git stash list   # 确保干净
# 临时把调用点改回 if [[ "$AUTO_WORKTREE" == "1" ]]; then
npx vitest run packages/engine/tests/launcher/claude-launch.test.ts -t '外部建的 worktree'
# Expected: FAIL —— 证明这条守卫真的盯着根因
git checkout scripts/claude-launch.sh   # 还原
```

- [ ] **Step 3: 真机端到端复验（最有说服力的一步）**

```bash
# 在一个真实 worktree 内跑 dry-run，确认输出含 ln -s
cd /Users/administrator/worktrees/cecelia/fix-slot-session-orphan-key
bash scripts/claude-launch.sh "$HOME/.claude-account2" --dry-run 2>&1 | grep 'ln -s'
# Expected: 有输出（修复前这里是空的——这正是本 bug）
```

- [ ] **Step 4: 全量单测不回归**

Run: `npx vitest run packages/engine/tests/launcher/`
Expected: 全绿。

- [ ] **Step 5: 更新 memory issue 状态**

把 `issue_session_history_scattered_resume_unfindable` 从「待修」改为「已修 + 根因坐实」，
并写明存量已并回、增量已由本 PR 修掉。

---

## Self-Review

**1. Spec coverage（设计文档 9 条改动 → Task 映射）**

| 设计改动 | Task | 覆盖 |
|---|---|---|
| 1 key 算法 | Task 1 | ✅ |
| 2 root 同源 + 账号解析提前 | Task 2 | ✅ |
| 3 解耦门禁 | Task 3 | ✅ |
| 4 软链只建不删 | Task 4 | ✅ |
| 5 `pwd -P` 硬失败 | Task 5 | ✅ |
| 6 安全护栏（`_is_real_dir`/`ln -sfn`/自指短路） | Task 3(自指) + Task 5 | ✅ |
| 7 孤儿并回不覆盖 | Task 6 | ✅ |
| 8 并发锁 | Task 7 | ✅ |
| 9 dry-run 契约同步 | Task 3 Step 4d | ✅ |

设计文档「测试策略」6 条 → Task 1/2/3/4/6/7 各自的 Step 1 + Task 8 总验收。✅ 无缺口。

**2. Placeholder scan**：无 TBD/TODO；每个代码步骤都给了完整可粘贴代码；无「同 Task N」引用。✅

**3. Type consistency**：
- helper 命名全程一致：`_path_to_project_key` / `_proj_root` / `_resolve_main_repo` / `_is_real_dir` / `_link_projects_dir` / `_with_link_lock`
- `_proj_root` 在 Task 2 定义，Task 3/7 引用 ✅
- `_resolve_main_repo` 在 Task 3 定义，仅 Task 3 引用 ✅
- `_is_real_dir` 在 Task 5 定义，Task 6 引用 ✅（Task 5 必须先于 Task 6 执行）
- 测试助手 `toKey` 在 Task 1 翻新，后续所有 Task 引用新语义 ✅（Task 1 必须最先执行）

**Task 顺序是硬依赖**：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8，不可乱序。
