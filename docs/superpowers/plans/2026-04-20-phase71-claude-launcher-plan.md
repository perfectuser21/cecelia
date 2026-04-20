# Phase 7.1 unified claude launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `scripts/claude-launch.sh` 统一启动器；改 `cecelia-run.sh` + `worktree-manage.sh::_resolve_claude_session_id` 让 headless/interactive/parallel 全部通过同一 session_id 机制被 Stop Hook 识别。

**Architecture:** launcher 脚本强制 `--session-id` + export `$CLAUDE_SESSION_ID` env；`_resolve_claude_session_id` env 优先；`cecelia-run.sh` 走 launcher；用户 shell alias 也走 launcher。Engine 18.0.0 → 18.1.0。

**Tech Stack:** bash / vitest / Cecelia Engine。

---

## File Structure

- **Create**：`scripts/claude-launch.sh`（10 行，可执行）
- **Create**：`packages/engine/tests/launcher/claude-launch.test.ts`
- **Create**：`packages/engine/tests/launcher/session-resolve.test.ts`
- **Modify**：`packages/engine/skills/dev/scripts/worktree-manage.sh`（`_resolve_claude_session_id` 加 env 优先分支）
- **Modify**：`packages/brain/scripts/cecelia-run.sh`（第 565 行 attempt=1 invoke 改成调 launcher）
- **Modify**：`.claude/CLAUDE.md`（加 alias 章节）
- **Modify**：Engine 6 处版本文件 + `packages/engine/skills/dev/SKILL.md`
- **Modify**：`packages/engine/feature-registry.yml`
- **Create**：`docs/learnings/cp-0420103233-phase71-claude-launcher.md`

---

## Task 1：写 claude-launch.test.ts（失败态）

**Files:**
- Create: `packages/engine/tests/launcher/claude-launch.test.ts`

- [ ] **Step 1.1：创建测试文件**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const LAUNCHER = resolve(__dirname, '../../../../scripts/claude-launch.sh');

describe('Phase 7.1 claude-launch.sh', () => {
  let mockDir: string;

  beforeAll(() => {
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-test-'));
    // mock claude: dump env + args
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, `#!/usr/bin/env bash
echo "CLAUDE_SESSION_ID=$CLAUDE_SESSION_ID"
echo "ARGS=$*"
`);
    chmodSync(mockClaude, 0o755);
  });

  afterAll(() => {
    rmSync(mockDir, { recursive: true, force: true });
  });

  it('launcher 脚本存在且可执行', () => {
    expect(existsSync(LAUNCHER)).toBe(true);
    const stat = execSync(`stat -f %p "${LAUNCHER}"`).toString().trim();
    expect(parseInt(stat, 8) & 0o111).toBeGreaterThan(0);
  });

  it('无 env 时生成新 UUID 并 export', () => {
    const out = execSync(`PATH="${mockDir}:$PATH" unset CLAUDE_SESSION_ID 2>/dev/null; bash "${LAUNCHER}" --help`, {
      shell: '/bin/bash',
      env: { ...process.env, PATH: `${mockDir}:${process.env.PATH}`, CLAUDE_SESSION_ID: '' },
    }).toString();
    const m = out.match(/CLAUDE_SESSION_ID=([a-f0-9-]+)/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  });

  it('有 env 时继承', () => {
    const out = execSync(`bash "${LAUNCHER}" --help`, {
      shell: '/bin/bash',
      env: { ...process.env, PATH: `${mockDir}:${process.env.PATH}`, CLAUDE_SESSION_ID: 'inherited-test-uuid' },
    }).toString();
    expect(out).toContain('CLAUDE_SESSION_ID=inherited-test-uuid');
    expect(out).toContain('--session-id inherited-test-uuid');
  });

  it('传 --session-id 给 claude', () => {
    const out = execSync(`bash "${LAUNCHER}" -p "test"`, {
      shell: '/bin/bash',
      env: { ...process.env, PATH: `${mockDir}:${process.env.PATH}`, CLAUDE_SESSION_ID: 'fixed-uuid' },
    }).toString();
    expect(out).toContain('--session-id fixed-uuid');
    expect(out).toContain('-p test');
  });
});
```

- [ ] **Step 1.2：跑测试确认失败**

```bash
cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts 2>&1 | tail -10
```

Expected：所有 test fail（launcher 不存在 / 不可执行）

- [ ] **Step 1.3：commit 失败态**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04201032-phase71-claude-launcher
git add packages/engine/tests/launcher/claude-launch.test.ts
git commit -m "test(engine): claude-launch.sh behavior (failing baseline)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：写 session-resolve.test.ts（失败态）

**Files:**
- Create: `packages/engine/tests/launcher/session-resolve.test.ts`

- [ ] **Step 2.1：创建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const WORKTREE_MANAGE = resolve(__dirname, '../../skills/dev/scripts/worktree-manage.sh');

describe('Phase 7.1 _resolve_claude_session_id', () => {
  // 用 bash source 方式把函数拉进来测
  const bashHelper = (envVar: string, extra: string = '') => `
source "${WORKTREE_MANAGE}" 2>/dev/null || true
${extra}
declare -f _resolve_claude_session_id >/dev/null || { echo "NO_FUNC"; exit 1; }
${envVar}
_resolve_claude_session_id
`;

  it('env var 路径：CLAUDE_SESSION_ID 有值时直接返回', () => {
    const out = execSync(`bash -c '${bashHelper("CLAUDE_SESSION_ID=env-test-uuid").replace(/'/g, "'\\''")}'`, {
      shell: '/bin/bash',
    }).toString().trim();
    expect(out).toBe('env-test-uuid');
  });

  it('都没有时返回空串', () => {
    const out = execSync(`bash -c '${bashHelper("unset CLAUDE_SESSION_ID").replace(/'/g, "'\\''")}'`, {
      shell: '/bin/bash',
      env: { ...process.env, CLAUDE_SESSION_ID: '' },
    }).toString().trim();
    // 父进程 cmdline 不会含 --session-id（test 跑在 node 里）
    expect(out).toBe('');
  });
});
```

- [ ] **Step 2.2：跑测试确认失败**

Expected：至少第一个 test fail（现函数 env var 优先级未实现）

- [ ] **Step 2.3：commit 失败态**

```bash
git add packages/engine/tests/launcher/session-resolve.test.ts
git commit -m "test(engine): session resolver env priority (failing baseline)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：新建 claude-launch.sh

**Files:**
- Create: `scripts/claude-launch.sh`

- [ ] **Step 3.1：写 launcher 脚本**

```bash
#!/usr/bin/env bash
# Cecelia 统一 claude 启动器
# 保证 headless / interactive / parallel 所有 claude 实例都有 --session-id + export 到子进程
# 用法：
#   直接用:  bash scripts/claude-launch.sh [-p PROMPT] [其他 claude 参数]
#   交互 alias:  alias claude='bash /absolute/path/to/scripts/claude-launch.sh'
#   headless:  CLAUDE_SESSION_ID=<uuid> bash scripts/claude-launch.sh -p "..."
set -euo pipefail

SID="${CLAUDE_SESSION_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
export CLAUDE_SESSION_ID="$SID"
exec claude --session-id "$SID" "$@"
```

- [ ] **Step 3.2：chmod +x**

```bash
chmod +x /Users/administrator/worktrees/cecelia/cp-04201032-phase71-claude-launcher/scripts/claude-launch.sh
```

- [ ] **Step 3.3：跑 claude-launch.test.ts 确认通过**

```bash
cd packages/engine && npx vitest run tests/launcher/claude-launch.test.ts 2>&1 | tail -5
```

Expected：4 tests 全绿

- [ ] **Step 3.4：commit launcher**

```bash
git add scripts/claude-launch.sh
git commit -m "feat(engine): phase7.1 unified claude launcher

$(cat <<'EOF'
10 行启动器。强制 --session-id + export CLAUDE_SESSION_ID。
headless/interactive/parallel 所有 claude 实例走同一路径。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4：改 `_resolve_claude_session_id` 加 env 优先

**Files:**
- Modify: `packages/engine/skills/dev/scripts/worktree-manage.sh:456-470`

- [ ] **Step 4.1：在函数开头加 env 优先检查**

改动位置：`_resolve_claude_session_id()` 函数体开头（行 457 `local pid="${PPID:-}"` 之前）。

替换原函数：
```bash
_resolve_claude_session_id() {
    local pid="${PPID:-}"
    local depth=0
    while ...
```

改为：
```bash
_resolve_claude_session_id() {
    # Phase 7.1: env var 优先（launcher export 的）
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        echo "$CLAUDE_SESSION_ID"
        return 0
    fi

    # Phase 7 fallback: 沿 PPID 链找 claude cmdline
    local pid="${PPID:-}"
    local depth=0
    while ...
```

（其他代码不变）

- [ ] **Step 4.2：跑 session-resolve.test.ts 确认通过**

Expected：2 tests 全绿

- [ ] **Step 4.3：commit**

```bash
git add packages/engine/skills/dev/scripts/worktree-manage.sh
git commit -m "feat(engine)[CONFIG]: _resolve_claude_session_id env var priority

Phase 7.1: launcher export \$CLAUDE_SESSION_ID 后子进程 bash 调
worktree-manage.sh 能直接读到，不用 fallback PPID cmdline 解析。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：改 cecelia-run.sh 走 launcher

**Files:**
- Modify: `packages/brain/scripts/cecelia-run.sh:565`

- [ ] **Step 5.1：找到现有 invoke 行**

搜索 `CLAUDE_INVOKE="claude -p`，改成：

```bash
if [[ $attempt -eq 1 ]]; then
  # Phase 7.1: 走统一 launcher
  local _launcher="${CECELIA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}/scripts/claude-launch.sh"
  CLAUDE_INVOKE="CLAUDE_SESSION_ID=$SESSION_UUID bash $_launcher -p \"\$1\""
else
  echo "[cecelia-run] 🔄 从 checkpoint resume (attempt=$attempt, session=$SESSION_UUID)" >&2
  CLAUDE_INVOKE="claude --resume $SESSION_UUID -p \"继续执行，上次因超时/中断未完成，请从中断处继续\""
fi
```

> attempt >= 2 保持 `claude --resume`（resume 路径不需要新 session_id）。

- [ ] **Step 5.2：commit**

```bash
git add packages/brain/scripts/cecelia-run.sh
git commit -m "feat(brain): cecelia-run.sh 走统一 claude-launch.sh

Phase 7.1: headless 派发从"直接调 claude"改成"调 launcher"，保证
env var CLAUDE_SESSION_ID 正确 export 给子进程链（worktree-manage.sh
能读到，Stop Hook 能精确匹配 owner_session）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：.claude/CLAUDE.md 加 alias 说明

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 6.1：在"## 6. 禁止事项"之前新增一节**

```markdown
---

## 6. Shell Alias 配置（强推荐）

为让 Stop Hook 循环机制对**交互模式**也生效，用户 `~/.zshrc` 或 `~/.bashrc` 加：

\`\`\`bash
alias claude='bash /Users/administrator/perfect21/cecelia/scripts/claude-launch.sh'
\`\`\`

**原理**：`claude-launch.sh` 强制 `--session-id` + export `$CLAUDE_SESSION_ID`，
让 `worktree-manage.sh` 能写正确的 owner_session，Stop Hook 能精确匹配 .dev-lock。

**不加 alias 的后果**：交互 claude 无 session_id → owner_session=unknown →
Stop Hook 永远 mismatch → exit 0 放行 → assistant 中途退出 → /dev 循环失效。

Headless 模式（Brain 派）已由 `cecelia-run.sh` 自动走 launcher，无需用户配置。

---
```

- [ ] **Step 6.2：commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: phase7.1 shell alias config for unified claude launcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：Engine 版本 bump 18.0.0 → 18.1.0

**Files:**
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`（2 处）
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/hooks/VERSION`
- Modify: `packages/engine/regression-contract.yaml`
- Modify: `packages/engine/skills/dev/SKILL.md`（frontmatter version）

- [ ] **Step 7.1：批量 version bump**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04201032-phase71-claude-launcher
# 单行简文件
echo "18.1.0" > packages/engine/VERSION
echo "18.1.0" > packages/engine/.hook-core-version
echo "18.1.0" > packages/engine/hooks/VERSION
# package.json
node -e "const f='packages/engine/package.json';const c=require('fs').readFileSync(f,'utf8').replace(/\"version\": \"18\.0\.0\"/,'\"version\": \"18.1.0\"');require('fs').writeFileSync(f,c);"
# package-lock 两处
node -e "const f='packages/engine/package-lock.json';const c=require('fs').readFileSync(f,'utf8').replace(/\"version\": \"18\.0\.0\"/g,'\"version\": \"18.1.0\"');require('fs').writeFileSync(f,c);"
# regression-contract
node -e "const f='packages/engine/regression-contract.yaml';const c=require('fs').readFileSync(f,'utf8').replace(/version: 18\.0\.0/,'version: 18.1.0').replace(/updated: 2026-04-20/,'updated: 2026-04-20');require('fs').writeFileSync(f,c);"
# skills/dev/SKILL.md frontmatter
node -e "const f='packages/engine/skills/dev/SKILL.md';const c=require('fs').readFileSync(f,'utf8').replace(/^version: 18\.0\.0/m,'version: 18.1.0');require('fs').writeFileSync(f,c);"
```

- [ ] **Step 7.2：跑 version sync test**

```bash
cd packages/engine && npx vitest run tests/version-sync/ 2>&1 | tail -5
```

Expected：6/6 全绿

- [ ] **Step 7.3：commit**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04201032-phase71-claude-launcher
git add packages/engine/VERSION packages/engine/package.json packages/engine/package-lock.json packages/engine/.hook-core-version packages/engine/hooks/VERSION packages/engine/regression-contract.yaml packages/engine/skills/dev/SKILL.md
git commit -m "chore(engine): bump version 18.0.0 -> 18.1.0 (phase 7.1 minor)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8：feature-registry + Learning + DoD ticks

**Files:**
- Modify: `packages/engine/feature-registry.yml`
- Create: `docs/learnings/cp-0420103233-phase71-claude-launcher.md`
- Modify: `docs/superpowers/specs/2026-04-20-phase71-claude-launcher-design.md`（勾 DoD）

- [ ] **Step 8.1：feature-registry 新增 phase-7.1 条目**

在 `changelog:` 顶部（最新在上）：

```yaml
  - version: "18.1.0"
    date: "2026-04-20"
    change: "feat"
    description: "Phase 7.1 — 统一 claude 启动器。Phase 7（v17.0.0）修 Stop Hook 多 worktree 路由只对 headless 模式有效（cecelia-run.sh 用 --session-id flag），交互模式用户手敲 claude 无 flag 导致 owner_session=unknown，Stop Hook 匹配失败 → exit 0 放行 → 循环机制失效。本 PR 根治：新建 scripts/claude-launch.sh（强制 --session-id + export \$CLAUDE_SESSION_ID），cecelia-run.sh 改成调 launcher，worktree-manage.sh::_resolve_claude_session_id 优先读 env var。用户 shell alias claude → launcher 后，交互/headless/parallel 走同一 session_id 机制。minor bump 18.0.0 → 18.1.0。"
    files:
      - "scripts/claude-launch.sh (new)"
      - "packages/brain/scripts/cecelia-run.sh (invoke launcher)"
      - "packages/engine/skills/dev/scripts/worktree-manage.sh (_resolve env priority)"
      - ".claude/CLAUDE.md (alias doc)"
      - "packages/engine/tests/launcher/*.test.ts (new)"
      - "Engine 7 处版本文件 (18.1.0)"
```

- [ ] **Step 8.2：写 Learning 文件**

```markdown
# cp-0420103233-phase71-claude-launcher — Learning

### 背景

Phase 7.1：统一 claude 启动器，让 headless/interactive/parallel 全部走同一 session_id 机制。

### 根本原因

Phase 7（v17.0.0）只修了 Stop Hook 读 session_id 的匹配逻辑，没修"源头写入"——交互 claude 没带 `--session-id` flag 时 worktree-manage.sh 写 owner_session="unknown"。2026-04-20 实测 Phase 8.1 PR 期间 Stop Hook 完全失效，assistant "宣布完成"就真结束。这是"Phase 7 只修了一半"的漏洞暴露。

### 下次预防

- [ ] 任何 Stop Hook 行为修复：必须同时验证 headless + interactive 两个路径（之前只验 headless 导致 Phase 7 遗漏）
- [ ] 任何"要求 session_id"的功能：走同一个 launcher 写入，不允许两条独立路径（防止配置漂移）
- [ ] launcher 是 Cecelia 约定唯一的 claude 启动入口；未来任何"增加 claude 启动参数"的需求都改 launcher，不直接改调用方
```

- [ ] **Step 8.3：DoD ticks**

```bash
node -e "const f='docs/superpowers/specs/2026-04-20-phase71-claude-launcher-design.md';const c=require('fs').readFileSync(f,'utf8').replace(/- \[ \]/g,'- [x]');require('fs').writeFileSync(f,c);"
```

- [ ] **Step 8.4：commit**

```bash
git add packages/engine/feature-registry.yml docs/learnings/cp-0420103233-phase71-claude-launcher.md docs/superpowers/specs/2026-04-20-phase71-claude-launcher-design.md
git commit -m "docs(phase7.1): registry + learning + DoD ticked

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 最终检查

- [ ] **Step 9.1：全量新测试**

```bash
cd packages/engine && npx vitest run tests/launcher/ tests/version-sync/ 2>&1 | tail -8
```

Expected：launcher 6 + version-sync 6 = 12 tests 全绿

- [ ] **Step 9.2：完工清理**

```bash
bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -10
```

Expected：3 项全绿 + "可以合并 PR"

- [ ] **Step 9.3：git log 查看 commit 链**

```bash
git log --oneline main..HEAD
```

Expected：9 commits（spec / plan / 2 failing tests / launcher / worktree-manage / cecelia-run / CLAUDE.md / version bump / registry+learning+DoD）
