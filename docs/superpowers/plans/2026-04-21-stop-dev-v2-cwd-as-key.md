# stop-dev-v2 (cwd-as-key) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `packages/engine/hooks/stop-dev-v2.sh` 原型（不接线），用 cwd 替代多字段所有权匹配，砍掉 ~253 行复杂度。

**Architecture:** Hook 从 stdin JSON 的 `cwd` 字段推导 worktree + branch + `.dev-mode.<branch>` 是否存在。存在且首行是 `dev` → 调 `devloop_check`，否则 fail-closed 或直接放行。原型阶段不改 `settings.json`，老 `stop-dev.sh` 继续挂线。

**Tech Stack:** bash (stop-dev-v2.sh) + vitest (测试) + 现有 `devloop-check.sh` SSOT

---

## File Structure

| 文件 | 职责 | 大小（预估） |
|---|---|---|
| `packages/engine/hooks/stop-dev-v2.sh` | 新 hook 实现（cwd-as-key） | ~60 行 |
| `packages/engine/tests/hooks/stop-dev-v2.test.ts` | 7 个契约行为测试 | ~230 行 |
| `packages/engine/VERSION` | engine 版本号（需 bump） | 1 行 |
| `packages/engine/package.json` | version 字段（需 bump） | 1 字段 |
| `packages/engine/package-lock.json` | 锁版本（需 bump 2 处） | 2 字段 |
| `packages/engine/.hook-core-version` | hook 核心版本（需 bump） | 1 行 |
| `packages/engine/regression-contract.yaml` | 回归契约（需 bump） | 1 字段 |
| `packages/engine/feature-registry.yml` | 新增 changelog 条目 | 1 条 |

文件边界：`stop-dev-v2.sh` 职责单一——判"当前 session 能不能结束"。测试文件和脚本同级目录结构。

---

## Task 1: TDD Red — 写测试文件（7 用例全部失败）

**Files:**
- Create: `packages/engine/tests/hooks/stop-dev-v2.test.ts`

- [ ] **Step 1.1: 创建测试文件**

写入 `packages/engine/tests/hooks/stop-dev-v2.test.ts`：

```typescript
/**
 * tests/hooks/stop-dev-v2.test.ts
 *
 * 测试 stop-dev-v2.sh 的 7 个契约行为
 * 契约定义: docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolve } from 'path';

const HOOK = resolve(__dirname, '../../hooks/stop-dev-v2.sh');

function runHook(opts: {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('bash', [HOOK], {
    cwd: opts.cwd ?? '/tmp',
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.stdin ?? '',
    encoding: 'utf-8',
    timeout: 10000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function makeGitDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'stop-dev-v2-'));
  const run = (cmd: string) => spawnSync('bash', ['-c', cmd], { cwd: d, encoding: 'utf-8' });
  run('git init -q');
  run('git config user.email t@e.com');
  run('git config user.name t');
  writeFileSync(join(d, 'README.md'), '#');
  run('git add . && git commit -q -m init');
  return d;
}

describe('stop-dev-v2.sh 契约行为', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeGitDir();
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('契约 1: CECELIA_STOP_HOOK_BYPASS=1 → exit 0', () => {
    const r = runHook({ env: { CECELIA_STOP_HOOK_BYPASS: '1' } });
    expect(r.status).toBe(0);
  });

  it('契约 2: CLAUDE_HOOK_CWD 空 + $PWD 非 git → exit 0', () => {
    const r = runHook({ cwd: '/tmp' });
    expect(r.status).toBe(0);
  });

  it('契约 3: cwd=主仓库（branch=main 分支名一致） → exit 0', () => {
    // git init 默认分支名取决于 git 配置，统一改到 main
    spawnSync('bash', ['-c', 'git branch -m main || true'], { cwd: dir });
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(0);
  });

  it('契约 4: cp-* 分支但无 .dev-mode → exit 0', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(0);
  });

  it('契约 5: .dev-mode 首行 branch=xxx（等号格式） → exit 2 fail-closed', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    writeFileSync(
      join(dir, '.dev-mode.cp-test-branch'),
      'branch=cp-test-branch\ntask=test\nagent=a\ncreated_at=2026-04-21\n',
    );
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('格式异常');
  });

  it('契约 6: .dev-mode 标准格式 + step_2_code=pending → exit 2 block', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    writeFileSync(
      join(dir, '.dev-mode.cp-test-branch'),
      'dev\nbranch: cp-test-branch\nstep_1_spec: done\nstep_2_code: pending\n',
    );
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(2);
    // devloop_check 返回 blocked JSON
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  });

  it('契约 7: .dev-mode 首行 dev 但缺 branch 字段 → exit 2 透传', () => {
    spawnSync('bash', ['-c', 'git checkout -qb cp-test-branch'], { cwd: dir });
    writeFileSync(
      join(dir, '.dev-mode.cp-test-branch'),
      'dev\nstep_1_spec: pending\n',
    );
    const r = runHook({ cwd: dir });
    expect(r.status).toBe(2);
    // devloop_check 会返回 blocked（缺 branch 也算业务异常）
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  });
});
```

- [ ] **Step 1.2: 运行测试确认 7 条全红**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/stop-dev-v2-prototype
npx vitest run packages/engine/tests/hooks/stop-dev-v2.test.ts --no-coverage
```

Expected: 7 failing (hook 文件尚不存在 → spawn bash 失败)

- [ ] **Step 1.3: Commit (TDD Red)**

```bash
git add packages/engine/tests/hooks/stop-dev-v2.test.ts
git commit -m "test(engine)[CONFIG]: stop-dev-v2 契约行为测试（TDD Red）

7 个契约用例覆盖 bypass / cwd fallback / 主仓库放行 /
无 dev-mode 放行 / 格式 fail-closed / devloop_check 透传。

hook 文件尚不存在，测试全部失败（TDD Red 阶段）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TDD Green — 写 stop-dev-v2.sh 让所有测试通过

**Files:**
- Create: `packages/engine/hooks/stop-dev-v2.sh`

- [ ] **Step 2.1: 创建 stop-dev-v2.sh**

写入 `packages/engine/hooks/stop-dev-v2.sh`：

```bash
#!/usr/bin/env bash
# ============================================================================
# stop-dev-v2.sh — cwd-as-key 原型（不接线，手工验证用）
# ============================================================================
# 设计原则：cwd = 所有权的唯一证据（无头 Claude 进程 cwd 永远是自己的 worktree）
# 对比 stop-dev.sh：313 行 → ~60 行
# 入口契约：stop.sh 解析 stdin JSON 后导出 CLAUDE_HOOK_CWD
# 完整设计：docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md
# ============================================================================

set -euo pipefail

# ---- 契约 1：逃生通道 ----------------------------------------------------
if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    echo "[stop-dev-v2] bypass via CECELIA_STOP_HOOK_BYPASS=1" >&2
    exit 0
fi

# ---- 契约 2：确定 cwd（fallback 到 $PWD） --------------------------------
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

# ---- 2/3/4：推 worktree + branch -----------------------------------------
wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

# 契约 3：主仓库/默认分支 → 放行
case "$branch" in
    main|master|develop|HEAD) exit 0 ;;
esac

# 契约 4：非 /dev 流程 → 放行
dev_mode="$wt_root/.dev-mode.$branch"
[[ ! -f "$dev_mode" ]] && exit 0

# ---- 加载 devloop-check SSOT ---------------------------------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
devloop_lib=""
for c in \
    "$wt_root/packages/engine/lib/devloop-check.sh" \
    "$script_dir/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { devloop_lib="$c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$devloop_lib" ]] && source "$devloop_lib"
command -v jq &>/dev/null || jq() { cat >/dev/null 2>&1; echo '{}'; }

# ---- 契约 5：格式异常 fail-closed ----------------------------------------
if ! head -1 "$dev_mode" 2>/dev/null | grep -q "^dev$"; then
    first_line=$(head -1 "$dev_mode" 2>/dev/null || echo "<empty>")
    jq -n --arg f "$dev_mode" --arg l "$first_line" \
      '{"decision":"block","reason":"dev-mode 格式异常（首行 [\($l)] 不是 dev）: \($f)。请删除该文件或修正为标准格式后重试。"}'
    exit 2
fi

# ---- 契约 6/7：调 devloop_check ------------------------------------------
if ! type devloop_check &>/dev/null; then
    jq -n '{"decision":"block","reason":"devloop-check.sh 未加载，fail-closed"}'
    exit 2
fi

result=$(devloop_check "$branch" "$dev_mode") || true
status=$(echo "$result" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

if [[ "$status" == "done" || "$status" == "merged" ]]; then
    rm -f "$dev_mode"
    jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成"}'
    exit 0
fi

# 未完成 → block（reason 透传 devloop_check 返回）
reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
[[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"

jq -n --arg r "$reason" --arg id "$run_id" \
  '{"decision":"block","reason":$r,"ci_run_id":$id}'
exit 2
```

- [ ] **Step 2.2: 赋执行权限**

Run:
```bash
chmod +x packages/engine/hooks/stop-dev-v2.sh
```

- [ ] **Step 2.3: 运行测试确认 7 条全绿**

Run:
```bash
npx vitest run packages/engine/tests/hooks/stop-dev-v2.test.ts --no-coverage
```

Expected: `Tests  7 passed`

如果有用例失败：
- 契约 5 失败 → 看测试输出的 stdout，确认是 JSON 还是空
- 契约 6/7 失败 → 检查 `devloop-check.sh` 能否 source 成功：`bash -c 'source packages/engine/lib/devloop-check.sh && type devloop_check'`
- 契约 3 失败 → 确认 git 默认分支名（新版 git 可能是 master 而非 main）

- [ ] **Step 2.4: 手工 smoke test**

Run 3 个场景验证契约：

```bash
# 契约 1：bypass
CECELIA_STOP_HOOK_BYPASS=1 bash packages/engine/hooks/stop-dev-v2.sh
echo "exit=$?"  # 预期 0

# 契约 3：主仓库（当前 cwd 是 worktree 分支 cp-*，应该不走放行路径）
bash packages/engine/hooks/stop-dev-v2.sh
echo "exit=$?"  # 预期 0（因为当前 worktree 分支是 cp-*，但无 .dev-mode.<branch>）

# 契约 5：格式异常
tmp=$(mktemp -d) && cd "$tmp" && git init -q && git commit -q --allow-empty -m init && \
  git checkout -qb cp-x && echo 'branch=x' > .dev-mode.cp-x && \
  CLAUDE_HOOK_CWD="$tmp" bash /Users/administrator/worktrees/cecelia/stop-dev-v2-prototype/packages/engine/hooks/stop-dev-v2.sh
echo "exit=$?"  # 预期 2，stdout 含"格式异常"
```

- [ ] **Step 2.5: Commit (TDD Green)**

```bash
git add packages/engine/hooks/stop-dev-v2.sh
git commit -m "feat(engine)[CONFIG]: stop-dev-v2 cwd-as-key 原型实现（TDD Green）

~60 行替代老 stop-dev.sh 的 ~253 行多字段所有权匹配：
- 所有权证据 = cwd（无头 Claude 进程 cwd 永远是自己的 worktree）
- 删掉 self-heal / owner 验证 / 跨 session orphan 隔离 / harness 分叉
- 格式异常 fail-closed（老行为静默跳过是根因之一）

原型不挂 settings.json，老 stop-dev.sh 继续运行。
手动测试入口：bash packages/engine/hooks/stop-dev-v2.sh
逃生通道保留：CECELIA_STOP_HOOK_BYPASS=1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Engine 版本 bump + feature-registry 登记

Engine 改动三要素（见 MEMORY.md）：PR title [CONFIG] + 5 文件 version bump + feature-registry changelog。

**Files:**
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`
- Modify: `packages/engine/feature-registry.yml`

- [ ] **Step 3.1: 读当前 engine 版本**

Run:
```bash
cat packages/engine/VERSION
cat packages/engine/.hook-core-version
grep -m1 '"version"' packages/engine/package.json
```

当前版本 18.3.4（根据早先观察）。新原型是**新增文件、不改既有 hook**，minor bump：18.3.4 → 18.4.0。

- [ ] **Step 3.2: 更新 VERSION**

Run:
```bash
echo '18.4.0' > packages/engine/VERSION
```

- [ ] **Step 3.3: 更新 .hook-core-version**

Run:
```bash
echo '18.4.0' > packages/engine/.hook-core-version
```

- [ ] **Step 3.4: 更新 package.json**

使用 Edit 工具：
- `"version": "18.3.4"` → `"version": "18.4.0"`

- [ ] **Step 3.5: 更新 package-lock.json**

package-lock.json 有 2 处 version（注意不要改 dependencies 里的 version）：
- 顶层 `"version": "18.3.4"` → `"version": "18.4.0"`
- `"packages": { "": { "version": "18.3.4"` → `"packages": { "": { "version": "18.4.0"`

Run 定位：
```bash
grep -n '"version"' packages/engine/package-lock.json | head -5
```

- [ ] **Step 3.6: 更新 regression-contract.yaml**

Run:
```bash
grep -n 'version:' packages/engine/regression-contract.yaml | head -3
```

使用 Edit：`version: 18.3.4` → `version: 18.4.0`

- [ ] **Step 3.7: 校验版本同步**

Run:
```bash
bash scripts/check-version-sync.sh 2>&1 | tail -15
```

Expected: `✅ 版本同步正常` 或类似全绿输出

- [ ] **Step 3.8: feature-registry 新增 changelog 条目**

在 `packages/engine/feature-registry.yml` 顶部（或 `changelog:` 段）添加：

```yaml
# 先读文件找到 changelog 区域/最近条目的位置
```

Run:
```bash
grep -n 'changelog\|^- version' packages/engine/feature-registry.yml | head -10
```

按现有格式追加一条（放最新位置）：

```yaml
- version: 18.4.0
  date: 2026-04-21
  type: feat
  scope: hooks
  summary: stop-dev-v2 cwd-as-key 原型（不接线）
  detail: |
    新增 packages/engine/hooks/stop-dev-v2.sh，用 cwd 替代老 stop-dev.sh 的多字段
    所有权匹配。60 行替代 313 行。不改 settings.json，老 hook 继续运行。
    原型阶段手工验证，稳定一周后切线。
  files_added:
    - packages/engine/hooks/stop-dev-v2.sh
    - packages/engine/tests/hooks/stop-dev-v2.test.ts
    - docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md
    - docs/superpowers/plans/2026-04-21-stop-dev-v2-cwd-as-key.md
```

**注意**：实际写入前，Read 现有 feature-registry.yml 确认格式（字段名/顺序可能不同），按现有样板填。

- [ ] **Step 3.9: 生成 path-views（engine 约定）**

Run:
```bash
bash packages/engine/scripts/generate-path-views.sh 2>&1 | tail -5
```

Expected: 无错误输出，或提示 "generated"

- [ ] **Step 3.10: Commit**

```bash
git add packages/engine/VERSION packages/engine/.hook-core-version \
  packages/engine/package.json packages/engine/package-lock.json \
  packages/engine/regression-contract.yaml packages/engine/feature-registry.yml \
  packages/engine/path-views/  # 如果 generate 生成了新内容

git commit -m "chore(engine)[CONFIG]: bump 18.3.4 → 18.4.0 + registry 登记

stop-dev-v2 原型新增：
- packages/engine/hooks/stop-dev-v2.sh
- packages/engine/tests/hooks/stop-dev-v2.test.ts

按 engine 三要素约定：
- 5 文件版本同步
- feature-registry changelog 新增条目
- path-views 重新生成

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: DoD 标记 + Learning 文件（push 前必备）

按 MEMORY.md DoD 三要素 + Learning 规则。

**Files:**
- Create: `.prd` 或 PR body DoD 段（命名惯例：`.dod` 放 worktree 根）
- Create: `docs/learnings/cp-0421145313-stop-dev-v2-prototype.md`

- [ ] **Step 4.1: 写 DoD 文件**

写入 `.dod`（worktree 根）：

```markdown
# DoD — stop-dev-v2 原型

- [x] [ARTIFACT] 新文件 packages/engine/hooks/stop-dev-v2.sh 存在
      Test: manual:node -e "require('fs').accessSync('packages/engine/hooks/stop-dev-v2.sh')"
- [x] [ARTIFACT] 新文件 packages/engine/tests/hooks/stop-dev-v2.test.ts 存在
      Test: manual:node -e "require('fs').accessSync('packages/engine/tests/hooks/stop-dev-v2.test.ts')"
- [x] [BEHAVIOR] bypass env 生效
      Test: manual:bash -c 'CECELIA_STOP_HOOK_BYPASS=1 bash packages/engine/hooks/stop-dev-v2.sh' (exit 0)
- [x] [BEHAVIOR] 7 个契约测试全绿
      Test: tests/hooks/stop-dev-v2.test.ts
- [x] [BEHAVIOR] engine 版本已 bump 5 文件
      Test: manual:bash scripts/check-version-sync.sh
- [x] [ARTIFACT] 设计文档已提交
      Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md')"
```

**重要**：所有条目 push 前必须 `[x]`（已勾选），否则 CI "未验证项检查" 失败。

- [ ] **Step 4.2: 写 Learning 文件**

写入 `docs/learnings/cp-0421145313-stop-dev-v2-prototype.md`：

```markdown
# Learning — stop-dev-v2 cwd-as-key 原型

分支：cp-0421145313-stop-dev-v2-prototype
日期：2026-04-21
Task：06891480-4524-4552-bf59-5ba93964f6b0

## 背景

Stop Hook（stop.sh + stop-dev.sh）累计 99 个 commit，近 5 周 50+ 次修复，
每次"根治"都暴露新 corner case。根因诊断：多字段所有权匹配（session_id /
tty / owner_session / dev-lock 存在性 / 格式版本 / harness 分叉）组合爆炸。

## 根本原因

把"这个 session 在跑 /dev 吗"的判断绑定在可写可错的 .dev-lock 字段上，
而不是进程事实（cwd）。无头 Claude 进程的 cwd 天然是自己的 worktree，
这是进程层事实，不会"丢失"需要自愈、也不会被别人伪造。

老设计让多个 writer（/dev 主流程、codex runner、外部 launcher、Claude
Agent isolation=worktree）都要对 .dev-lock 格式达成协议——外部 launcher
不写或写错格式 → hook 静默放行 → 无头任务中途退出。

## 下次预防

- [ ] 任何"会话/进程身份"的判断优先用**进程层事实**（cwd、pid、env
      CLAUDE_HOOK_CWD 之类协议自带字段），不要靠工作目录里的元数据文件
- [ ] 同一功能如果 3 次修复还不收敛，按 systematic-debugging Phase 4.5
      停下来**质疑架构**，不要打第 4 个补丁
- [ ] Hook 读状态文件时 fail-closed（格式异常 block + 暴露问题），
      不要 silent skip（silent skip 会把无头任务默默放走）
- [ ] 新 hook 原型先不挂 settings.json，写手工 smoke test + 一周稳定
      观察再切线，不要一次替换

## 下一步（本 PR 合并后）

1. 手工 smoke 一周，观察是否有原型漏掉的场景
2. 写切换脚本（同时运行 stop-dev.sh + stop-dev-v2.sh 做 shadow 对比）
3. 切线：settings.json 指向 stop-dev-v2.sh
4. 删除 stop-dev.sh + .dev-lock 写入代码 + self-heal 相关逻辑
```

- [ ] **Step 4.3: Commit**

```bash
git add .dod docs/learnings/cp-0421145313-stop-dev-v2-prototype.md
git commit -m "docs[CONFIG]: DoD + Learning for stop-dev-v2 原型

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 验证全部 DoD 再 push

- [ ] **Step 5.1: 运行全部 manual DoD 命令**

Run:
```bash
node -e "require('fs').accessSync('packages/engine/hooks/stop-dev-v2.sh')" && echo OK1
node -e "require('fs').accessSync('packages/engine/tests/hooks/stop-dev-v2.test.ts')" && echo OK2
CECELIA_STOP_HOOK_BYPASS=1 bash packages/engine/hooks/stop-dev-v2.sh && echo OK3
npx vitest run packages/engine/tests/hooks/stop-dev-v2.test.ts --no-coverage && echo OK4
bash scripts/check-version-sync.sh && echo OK5
node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md')" && echo OK6
```

Expected: OK1~OK6 全部出现，vitest 7 passed。

- [ ] **Step 5.2: 最终 git log 检查**

Run:
```bash
git log --oneline main..HEAD
```

Expected: 4~5 个 commit（设计 / Red / Green / registry bump / DoD+Learning）。

- [ ] **Step 5.3: push → PR**

交给 finishing-a-development-branch skill 处理（/dev 主流程接管）。

---

## Self-Review Checklist

- [x] **Spec 覆盖**：7 个契约 → Task 1 测试 7 用例 + Task 2 脚本 7 行为段注释
- [x] **Placeholder 扫描**：无 TBD / TODO；feature-registry step 3.8 有个"按现有样板填"的变通（正确做法，不是占位符）
- [x] **Type 一致性**：`stop-dev-v2.sh` 路径全文一致；`.dev-mode.<branch>` 文件名格式一致；engine 版本号 18.4.0 全文一致
- [x] **Engine 三要素**：[CONFIG] PR title + 5 文件 bump（Task 3）+ feature-registry changelog（Step 3.8） + path-views 重生成（Step 3.9）
- [x] **DoD 三要素**：[BEHAVIOR] 标签有、push 前勾 `[x]`（Step 4.1）、`feat` PR 有 test 文件（Task 1）
- [x] **Learning 规则**：第一次 push 前写好（Task 4）、含"根本原因"+"下次预防"+checklist、per-branch 文件名
