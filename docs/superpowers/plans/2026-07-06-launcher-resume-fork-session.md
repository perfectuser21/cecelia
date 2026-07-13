# launcher resume/continue 自动追加 --fork-session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `claude --resume`/`-c` 经 launcher 启动时因 `--session-id` 冲突秒退的 bug。

**Architecture:** `scripts/claude-launch.sh` 在 ARGS 解析循环后检测 resume/continue flags，缺 `--fork-session` 则追加进 ARGS；dry-run echo 与真实 FINAL_CMD 同源消费 ARGS，自然同步。TDD：dry-run 契约测试先行。

**Tech Stack:** bash 3.2（macOS 默认，`set -euo pipefail`）、vitest（packages/engine）。

---

### Task 1: 失败测试（commit-1）

**Files:**
- Modify: `packages/engine/tests/launcher/launcher-dry-run.test.ts`

- [ ] **Step 1: 追加 4 个失败 case**

在 `launcher-dry-run.test.ts` 顶层追加第二个 describe（保留现有内容不动）：

```typescript
describe('claude-launch.sh resume/continue 自动追加 --fork-session', () => {
  const claudeLaunch = resolve(__dirname, '../../../../scripts/claude-launch.sh')
  const env = { ...process.env, CECELIA_NO_AUTO_WORKTREE: '1' }

  it('--dry-run --resume <id> 输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run --resume abc123`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  it('--dry-run -c 输出含 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run -c`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).toMatch(/--fork-session/)
  })

  it('用户已带 --fork-session 时不重复追加（恰出现 1 次）', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run --resume abc123 --fork-session`, { encoding: 'utf8', timeout: 5000, env })
    expect(out.match(/--fork-session/g)).toHaveLength(1)
  })

  it('无 resume/continue 时不出现 --fork-session', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run`, { encoding: 'utf8', timeout: 5000, env })
    expect(out).not.toMatch(/--fork-session/)
  })
})
```

- [ ] **Step 2: 跑测试确认前 2 个 case 红**

Run: `cd packages/engine && npx vitest run tests/launcher/launcher-dry-run.test.ts`
Expected: case 1/2 FAIL（输出无 --fork-session），case 3/4 PASS（3 透传本来就出现 1 次，4 本来就不出现）——TDD 红灯以 1/2 为准。

- [ ] **Step 3: Commit（只提测试）**

```bash
git add packages/engine/tests/launcher/launcher-dry-run.test.ts
git commit -m "test(engine): launcher resume/continue 需追加 --fork-session 的失败契约测试"
```

### Task 2: 最小实现（commit-2）

**Files:**
- Modify: `scripts/claude-launch.sh:25`（ARGS 解析 for 循环结束后、`_is_headless` 注释前）

- [ ] **Step 1: 插入检测逻辑**

在 `done`（ARGS 解析循环结束，L25）之后插入：

```bash
# resume/continue 与强制注入的 --session-id 同用时，claude CLI 要求 --fork-session：
# 恢复的对话 fork 到本次 launcher 分配的新 session-id 下（与 per-session worktree 模型自洽）。
# 已知可接受边角：某 flag 的值恰为字符串 -r/-c 会误判追加（claude CLI 无此组合场景）。
_HAS_RESUME=0; _HAS_FORK=0
for arg in ${ARGS[@]+"${ARGS[@]}"}; do
    case "$arg" in
        --resume|--resume=*|-r|--continue|--continue=*|-c) _HAS_RESUME=1 ;;
        --fork-session) _HAS_FORK=1 ;;
    esac
done
if [[ "$_HAS_RESUME" == "1" && "$_HAS_FORK" == "0" ]]; then
    ARGS+=("--fork-session")
fi
```

- [ ] **Step 2: 语法冒烟 + 跑测试确认全绿**

Run: `bash -n scripts/claude-launch.sh && cd packages/engine && npx vitest run tests/launcher/`
Expected: 全部 PASS（含既有 case）。

- [ ] **Step 3: Commit**

```bash
git add scripts/claude-launch.sh
git commit -m "fix(engine): launcher 检测 --resume/-r/--continue/-c 自动追加 --fork-session（修 claude --resume 秒退）"
```

### Task 3: 版本 bump + changelog（commit-3）

**Files:**
- Modify: `packages/engine/package.json`（version 19.4.0→19.4.1）
- Modify: `packages/engine/package-lock.json`（2 处 version）
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/hooks/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`（`version:` 行）
- Modify: `packages/engine/feature-registry.yml`（changelog 末尾追加）

- [ ] **Step 1: 六处版本号 19.4.0 → 19.4.1**

逐文件把 `19.4.0` 改为 `19.4.1`（package-lock.json 是 2 处：根 version + packages."" version）。

- [ ] **Step 2: feature-registry.yml changelog 追加**

照既有条目格式（date/type/description/files 四字段）在 changelog 末尾追加：

```yaml
  - version: "19.4.1"
    date: "2026-07-06"
    type: "fix"
    description: "launcher 检测 --resume/-r/--continue/-c 自动追加 --fork-session，修 claude --resume 经 launcher 启动秒退"
    files:
      - "../../scripts/claude-launch.sh (resume/continue fork-session 检测)"
```

- [ ] **Step 3: 版本同步校验 + 全量测试**

Run: `bash packages/engine/ci/scripts/check-version-sync.sh && cd packages/engine && npm test`
Expected: 版本同步 PASS，测试全绿。

- [ ] **Step 4: Commit**

```bash
git add packages/engine/package.json packages/engine/package-lock.json packages/engine/VERSION packages/engine/hooks/VERSION packages/engine/.hook-core-version packages/engine/regression-contract.yaml packages/engine/feature-registry.yml
git commit -m "chore(engine): bump 19.4.1——launcher fork-session 修复"
```
