# Stop Hook v23 PR-2 核心切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 stop-dev.sh 从 v22 209 行模型重写为 v23 ~60 行心跳模型，engine-worktree 启动 guardian + 写灯文件，engine-ship 关 guardian + 写 done-marker。

**Architecture:** stop hook 不再读 dev-active-*.json + 跑 verify_dev_complete，改读 lights/ 目录扫 mtime。所有权键从 cwd+session_id 双通道统一为 sid_short 前缀（文件名）。完成判定从软件状态机改为 OS 文件 mtime（事实级）。

**Tech Stack:** Bash 4+，jq，vitest 3.x，Node.js child_process。

**Spec:** `docs/superpowers/specs/2026-05-07-stop-hook-v23-pr2-core-switch-design.md`
**Master Design:** `docs/design/stop-hook-v23-redesign.md`
**Brain Task:** `f29c8f71-584d-46dd-8c0d-3920db3aa261`
**前置 PR：** [#2823](https://github.com/perfectuser21/cecelia/pull/2823) (PR-1) 已合，PR-1 提供 guardian / abort / log_hook_decision / launcher dry-run。

---

## File Structure

### 新建（Create）

| 路径 | 职责 |
|---|---|
| `packages/engine/scripts/ship-finalize.sh` | engine-ship 调用：写 done-marker + SIGTERM guardian |
| `packages/engine/tests/hooks/stop-hook-v23-decision.test.ts` | hook 决策矩阵 8 case |
| `packages/engine/tests/hooks/stop-hook-v23-routing.test.ts` | 路由 / 特殊场景 5 case |
| `packages/engine/tests/skills/engine-worktree-guardian.test.ts` | engine-worktree 启 guardian + 写灯 3 case |
| `packages/engine/tests/skills/engine-ship-guardian.test.ts` | engine-ship 关 guardian + 写 done-marker 3 case |

### 修改（Modify）

| 路径 | 改动 |
|---|---|
| `packages/engine/hooks/stop-dev.sh` | 整体重写（209 行 → ~70 行） |
| `packages/engine/skills/dev/scripts/worktree-manage.sh` | cmd_create 末尾新增：mkdir lights/、写灯文件 JSON、fork guardian 后台 |
| `packages/engine/skills/engine-ship/SKILL.md` | § 3 之前插入：调 ship-finalize.sh |
| `packages/engine/feature-registry.yml` | 加 18.24.0 changelog |
| `scripts/check-single-exit.sh` | 新 stop-dev.sh 不再调 verify_dev_complete + 不读 dev-active；更新 lint 期望 |
| `packages/engine/{VERSION, .hook-core-version, package.json, package-lock.json, regression-contract.yaml}` | 18.23.1 → 18.24.0 |
| `packages/engine/hooks/{VERSION, .hook-core-version}` | 同上 |
| `packages/engine/skills/dev/SKILL.md` | frontmatter version → 18.24.0 |

---

## Task 1：写全部失败测试 + commit 1（TDD）

**目标**：4 套 vitest 测试 + 19 cases 全部 fail（实现尚未就位）。

### Step 1.1：写 stop-hook-v23-decision.test.ts（hook 决策矩阵）

- [ ] **创建文件**

```typescript
// packages/engine/tests/hooks/stop-hook-v23-decision.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, utimesSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

function runHook(testRepo: string, sessionId: string): { stdout: string, stderr: string, code: number } {
  const payload = JSON.stringify({ session_id: sessionId })
  try {
    const out = execSync(
      `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} echo '${payload}' | bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    return { stdout: out, stderr: '', code: 0 }
  } catch (e: any) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', code: e.status }
  }
}

function makeLight(lightsDir: string, sidShort: string, branch: string, opts: { ageSeconds?: number, guardianPid?: number } = {}) {
  mkdirSync(lightsDir, { recursive: true })
  const f = join(lightsDir, `${sidShort}-${branch}.live`)
  writeFileSync(f, JSON.stringify({
    session_id: `${sidShort}-full-uuid`,
    branch,
    worktree_path: `/tmp/wt-${branch}`,
    started_at: new Date().toISOString(),
    host: 'test-host',
    guardian_pid: opts.guardianPid || 99999,
  }))
  if (opts.ageSeconds) {
    const t = (Date.now() - opts.ageSeconds * 1000) / 1000
    utimesSync(f, t, t)
  }
  return f
}

describe('stop-dev.sh v23 decision matrix', () => {
  let testRepo: string
  let lightsDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'hookv23-'))
    execSync(`cd ${testRepo} && git init -q && git commit --allow-empty -m init -q`)
    lightsDir = join(testRepo, '.cecelia/lights')
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  it('1 自己的灯亮（mtime 新鲜）→ block', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
  })

  it('2 自己的灯熄（mtime 超 5min）→ release', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test', { ageSeconds: 600 })
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).not.toMatch(/decision.*block/)
  })

  it('3 别人的灯亮 + 自己没灯 → release', () => {
    makeLight(lightsDir, 'def67890', 'cp-other')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).not.toMatch(/decision.*block/)
  })

  it('4 别人的灯亮 + 自己的灯亮 → block（只看自己）', () => {
    makeLight(lightsDir, 'def67890', 'cp-other')
    makeLight(lightsDir, 'abc12345', 'cp-mine')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
    expect(r.stdout).toMatch(/cp-mine/)
  })

  it('5 自己 3 灯亮（多 worktree 并行）→ block + reason 含数量', () => {
    makeLight(lightsDir, 'abc12345', 'cp-1')
    makeLight(lightsDir, 'abc12345', 'cp-2')
    makeLight(lightsDir, 'abc12345', 'cp-3')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
    expect(r.stdout).toMatch(/3\s*条/)
  })

  it('6 lights/ 目录不存在 → release（普通对话）', () => {
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).not.toMatch(/decision.*block/)
  })

  it('7 BYPASS=1 → release', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    const out = execSync(
      `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} CECELIA_STOP_HOOK_BYPASS=1 echo '{"session_id":"abc12345-x"}' | bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    expect(out).not.toMatch(/decision.*block/)
  })

  it('8 灯文件 JSON 损坏 → 仍能给出 reason（branch 字段空但不挂）', () => {
    mkdirSync(lightsDir, { recursive: true })
    writeFileSync(join(lightsDir, 'abc12345-cp-broken.live'), '{this is not json')
    const r = runHook(testRepo, 'abc12345-full-uuid')
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
  })
})
```

- [ ] **跑测试验证 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr2
npx vitest run packages/engine/tests/hooks/stop-hook-v23-decision.test.ts 2>&1 | tail -10
```

Expected: 8 case fail（hook 还是 v22，不读 lights/，不会按 v23 行为决策）。

### Step 1.2：写 stop-hook-v23-routing.test.ts（路由 / 特殊场景）

- [ ] **创建文件**

```typescript
// packages/engine/tests/hooks/stop-hook-v23-routing.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

function makeLight(lightsDir: string, sidShort: string, branch: string) {
  mkdirSync(lightsDir, { recursive: true })
  writeFileSync(join(lightsDir, `${sidShort}-${branch}.live`), JSON.stringify({
    session_id: `${sidShort}-full`, branch, worktree_path: `/tmp/${branch}`, guardian_pid: 99999
  }))
}

describe('stop-dev.sh v23 routing & 特殊场景', () => {
  let testRepo: string
  let lightsDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'hookv23r-'))
    execSync(`cd ${testRepo} && git init -q && git commit --allow-empty -m init -q`)
    lightsDir = join(testRepo, '.cecelia/lights')
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  it('1 session_id 缺 + tty → release（手动 bash hook < /dev/null）', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    // 强制 tty 模式：直接 bash hook（不通过 echo pipe）
    const out = execSync(
      `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} bash ${HOOK} < /dev/null`,
      { encoding: 'utf8' }
    )
    // tty 检测取决于 stdin 是否是终端；用 </dev/null 给空 stdin，hook 看 hook_session_id="" + ! -t 0
    // 为简化，验证 stdout 不含 block decision
    expect(out).not.toMatch(/decision.*block/)
  })

  it('2 session_id 缺 + 非 tty (空 payload via pipe) → block', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    let out = ''
    try {
      out = execSync(
        `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} echo '' | bash ${HOOK}`,
        { encoding: 'utf8' }
      )
    } catch (e: any) { out = e.stdout || '' }
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
    expect(out).toMatch(/系统异常|no_session_id/)
  })

  it('3 cwd drift 到主仓库 main：仍 block 自己 session 的灯', () => {
    // 模拟：CLAUDE_HOOK_CWD=主仓库（非 worktree）；lights/ 在主仓库 .cecelia/
    makeLight(lightsDir, 'abc12345', 'cp-x')
    const out = execSync(
      `cd ${testRepo} && CLAUDE_HOOK_CWD=${testRepo} echo '{"session_id":"abc12345-x"}' | bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    expect(out).toMatch(/"decision"\s*:\s*"block"/)
  })

  it('4 不在 git 仓库 → release（普通系统目录）', () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'nogit-'))
    let out = ''
    try {
      out = execSync(
        `cd ${noGitDir} && CLAUDE_HOOK_CWD=${noGitDir} echo '{"session_id":"abc12345-x"}' | bash ${HOOK}`,
        { encoding: 'utf8' }
      )
    } catch (e: any) { out = e.stdout || '' }
    expect(out).not.toMatch(/decision.*block/)
    rmSync(noGitDir, { recursive: true, force: true })
  })

  it('5 hook 决策日志写入 ~/.claude/hook-logs/stop-dev.jsonl', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    const fakeHome = mkdtempSync(join(tmpdir(), 'hooklog-'))
    execSync(
      `cd ${testRepo} && HOME=${fakeHome} CLAUDE_HOOK_CWD=${testRepo} echo '{"session_id":"abc12345-x"}' | bash ${HOOK}`,
      { encoding: 'utf8' }
    )
    const logFile = join(fakeHome, '.claude/hook-logs/stop-dev.jsonl')
    const log = require('fs').readFileSync(logFile, 'utf8').trim()
    const last = JSON.parse(log.split('\n').pop()!)
    expect(last.decision).toBe('block')
    expect(last.reason_code).toBe('lights_alive')
    rmSync(fakeHome, { recursive: true, force: true })
  })
})
```

- [ ] **跑测试验证 fail**

```bash
npx vitest run packages/engine/tests/hooks/stop-hook-v23-routing.test.ts 2>&1 | tail -10
```

Expected: 5 case fail（v22 行为不一致）。

### Step 1.3：写 engine-worktree-guardian.test.ts

- [ ] **创建文件**

```typescript
// packages/engine/tests/skills/engine-worktree-guardian.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const SCRIPT = resolve(__dirname, '../../skills/dev/scripts/worktree-manage.sh')

describe('worktree-manage.sh + guardian fork（PR-2）', () => {
  let mainRepo: string

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'wtgrd-'))
    execSync(
      `cd ${mainRepo} && git init -q && git commit --allow-empty -m init -q && git branch -M main`,
      { stdio: 'pipe' }
    )
  })

  afterEach(() => {
    // 杀残留 guardian
    try { execSync(`pkill -f 'dev-heartbeat-guardian.sh.*${mainRepo}' || true`) } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('1 cmd_create 后 .cecelia/lights/<sid>-<branch>.live 存在', () => {
    const env = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-feat-test', GUARDIAN_INTERVAL_SEC: '1' }
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-pr2-1`, { encoding: 'utf8', env })

    const lightsDir = join(mainRepo, '.cecelia/lights')
    expect(existsSync(lightsDir)).toBe(true)
    const files = require('fs').readdirSync(lightsDir).filter((f: string) => f.startsWith('abc12345-cp-'))
    expect(files.length).toBeGreaterThan(0)

    const light = JSON.parse(readFileSync(join(lightsDir, files[0]), 'utf8'))
    expect(light.session_id).toBe('abc12345-feat-test')
    expect(light.guardian_pid).toBeGreaterThan(0)
    expect(light.branch).toMatch(/^cp-/)
  })

  it('2 guardian 进程启动且每秒刷新 mtime', async () => {
    const env = { ...process.env, CLAUDE_SESSION_ID: 'def67890-feat-x', GUARDIAN_INTERVAL_SEC: '1' }
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-pr2-2`, { encoding: 'utf8', env })

    const lightsDir = join(mainRepo, '.cecelia/lights')
    const files = require('fs').readdirSync(lightsDir).filter((f: string) => f.startsWith('def67890-'))
    const lightFile = join(lightsDir, files[0])

    const m1 = require('fs').statSync(lightFile).mtimeMs
    await new Promise(r => setTimeout(r, 2200))
    const m2 = require('fs').statSync(lightFile).mtimeMs

    expect(m2).toBeGreaterThan(m1)  // mtime 被更新
  }, 8000)

  it('3 灯文件 guardian_pid 字段引用真实进程', () => {
    const env = { ...process.env, CLAUDE_SESSION_ID: 'ghi11223-test', GUARDIAN_INTERVAL_SEC: '1' }
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-pr2-3`, { encoding: 'utf8', env })

    const lightsDir = join(mainRepo, '.cecelia/lights')
    const files = require('fs').readdirSync(lightsDir).filter((f: string) => f.startsWith('ghi11223-'))
    const light = JSON.parse(readFileSync(join(lightsDir, files[0]), 'utf8'))

    // process.kill(pid, 0) 不抛 → 进程存在
    expect(() => process.kill(light.guardian_pid, 0)).not.toThrow()
  })
})
```

- [ ] **跑验证 fail**

```bash
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine/tests/skills/engine-worktree-guardian.test.ts 2>&1 | tail -10
```

Expected: 3 case fail（worktree-manage.sh 还没 fork guardian）。

### Step 1.4：写 engine-ship-guardian.test.ts

- [ ] **创建文件**

```typescript
// packages/engine/tests/skills/engine-ship-guardian.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawn } from 'child_process'
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const SHIP_FINALIZE = resolve(__dirname, '../../scripts/ship-finalize.sh')
const GUARDIAN = resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')

describe('ship-finalize.sh — 关 guardian + 写 done-marker（PR-2）', () => {
  let mainRepo: string
  let lightsDir: string
  let doneDir: string

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'shipgrd-'))
    execSync(`cd ${mainRepo} && git init -q && git commit --allow-empty -m init -q`)
    lightsDir = join(mainRepo, '.cecelia/lights')
    doneDir = join(mainRepo, '.cecelia/done-markers')
    mkdirSync(lightsDir, { recursive: true })
    mkdirSync(doneDir, { recursive: true })
  })

  afterEach(() => {
    try { execSync(`pkill -f 'dev-heartbeat-guardian' || true`) } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('1 ship-finalize 写 done-marker 到 .cecelia/done-markers/', () => {
    const branch = 'cp-test-ship-1'
    const lightFile = join(lightsDir, `xyz77777-${branch}.live`)
    const proc = spawn('bash', [GUARDIAN, lightFile], {
      env: { ...process.env, GUARDIAN_INTERVAL_SEC: '1' }, detached: false
    })
    return new Promise<void>(resolve_promise => {
      setTimeout(() => {
        writeFileSync(lightFile, JSON.stringify({ branch, guardian_pid: proc.pid }))

        execSync(
          `cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 2823 https://github.com/foo/bar/pull/2823`,
          { encoding: 'utf8' }
        )

        const marker = join(doneDir, `xyz77777-${branch}.done`)
        expect(existsSync(marker)).toBe(true)
        const m = JSON.parse(readFileSync(marker, 'utf8'))
        expect(m.branch).toBe(branch)
        expect(m.pr_number).toBe(2823)
        expect(m.merged).toBe(true)
        resolve_promise()
      }, 500)
    })
  }, 5000)

  it('2 ship-finalize 杀 guardian → 灯文件被清', async () => {
    const branch = 'cp-test-ship-2'
    const lightFile = join(lightsDir, `aaa88888-${branch}.live`)
    const proc = spawn('bash', [GUARDIAN, lightFile], {
      env: { ...process.env, GUARDIAN_INTERVAL_SEC: '1' }, detached: false
    })
    await new Promise(r => setTimeout(r, 500))
    writeFileSync(lightFile, JSON.stringify({ branch, guardian_pid: proc.pid }))

    execSync(`cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 2823 https://x/y/z`, { encoding: 'utf8' })

    await new Promise(r => setTimeout(r, 600))
    expect(existsSync(lightFile)).toBe(false)
    let alive = true
    try { process.kill(proc.pid!, 0) } catch { alive = false }
    expect(alive).toBe(false)
  }, 5000)

  it('3 ship-finalize 找不到匹配灯：退出 1，不报内部错', () => {
    let code = 0
    try {
      execSync(`cd ${mainRepo} && bash ${SHIP_FINALIZE} nonexistent-branch 1 https://x/y/z`, {
        encoding: 'utf8', stdio: 'pipe'
      })
    } catch (e: any) { code = e.status }
    expect(code).toBe(1)
  })
})
```

- [ ] **跑验证 fail**

```bash
npx vitest run packages/engine/tests/skills/engine-ship-guardian.test.ts 2>&1 | tail -10
```

Expected: 3 case fail（ship-finalize.sh 还没创建）。

### Step 1.5：commit 1（fail tests）

- [ ] **add + commit**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr2

git add packages/engine/tests/hooks/stop-hook-v23-decision.test.ts \
        packages/engine/tests/hooks/stop-hook-v23-routing.test.ts \
        packages/engine/tests/skills/engine-worktree-guardian.test.ts \
        packages/engine/tests/skills/engine-ship-guardian.test.ts

git commit -m "$(cat <<'EOF'
test(engine): stop-hook-v23 PR-2 — fail tests (TDD commit 1)

19 cases 全部 fail（实现尚未就位）：
- stop-hook-v23-decision: 决策矩阵 8 case (灯亮/熄/多流/跨 session/JSON 损坏)
- stop-hook-v23-routing: 路由 + 特殊场景 5 case (tty/cwd drift/日志/非 git)
- engine-worktree-guardian: cmd_create + guardian fork + 灯文件 3 case
- engine-ship-guardian: ship-finalize done-marker + kill guardian 3 case

下个 commit 写实现让测试转 PASS。

Refs: docs/superpowers/specs/2026-05-07-stop-hook-v23-pr2-core-switch-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2：实现全部代码 + commit 2

### Step 2.1：重写 stop-dev.sh 为 ~70 行

- [ ] **完全替换 packages/engine/hooks/stop-dev.sh**

```bash
#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — Stop Hook v23.0.0（心跳模型）
# ============================================================================
# 替换 v22 的"考证档案"模型（cwd 路由 + session_id 双通道 + ghost rm + mtime
# expire）。新模型：扫 .cecelia/lights/<sid_short>-*.live，任一 mtime 新鲜 → block。
#
# 决策原理：mtime 是 OS 级事实，没有歧义。guardian 进程死/卡 = 灯熄 = 自动放行。
# 跨 session 隔离：只看文件名以"自己 session_id 前 8 位"开头的灯。
# ============================================================================
set -uo pipefail

# === 1. Hook stdin（Claude Code Stop Hook 协议传 session_id）===
hook_payload=""
if [[ -t 0 ]]; then
    hook_payload="{}"
else
    hook_payload=$(cat 2>/dev/null || echo "{}")
fi
hook_session_id=$(echo "$hook_payload" | jq -r '.session_id // ""' 2>/dev/null || echo "")

# === 2. Bypass 逃生通道 ===
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# === 3. 找主仓库（cwd 仅用来定位主仓库，不参与决策）===
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
[[ -z "$main_repo" ]] && exit 0  # 不在 git，普通对话

lights_dir="$main_repo/.cecelia/lights"
[[ ! -d "$lights_dir" ]] && exit 0  # 没人开过灯，普通对话

# === 4. 加载 log_hook_decision（PR-1 落点：devloop-check.sh）===
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for c in "$main_repo/packages/engine/lib/devloop-check.sh" \
         "$script_dir/../lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { source "$c" 2>/dev/null || true; break; }
done
type log_hook_decision &>/dev/null || log_hook_decision() { :; }

# === 5. session_id 缺失分两路 ===
if [[ -z "$hook_session_id" ]]; then
    if [[ -t 0 ]]; then
        # tty 手动跑 hook，不反人类
        exit 0
    fi
    # 真实 hook fire 但 stdin 没传 → 红灯日志 + 保守 block
    log_hook_decision "" "block" "no_session_id" 0 ""
    jq -n '{"decision":"block","reason":"Stop hook 收到空 session_id（系统异常），保守 block。"}'
    exit 0
fi

sid_short="${hook_session_id:0:8}"

# === 6. 扫自己 session 的灯 ===
TTL_SEC="${STOP_HOOK_LIGHT_TTL_SEC:-300}"
now=$(date +%s)
my_alive_count=0
my_first_branch=""

for light in "$lights_dir/${sid_short}-"*.live; do
    [[ -f "$light" ]] || continue
    if [[ "$(uname)" == "Darwin" ]]; then
        light_mtime=$(stat -f %m "$light" 2>/dev/null || echo 0)
    else
        light_mtime=$(stat -c %Y "$light" 2>/dev/null || echo 0)
    fi
    [[ "$light_mtime" =~ ^[0-9]+$ ]] || light_mtime=0
    age=$(( now - light_mtime ))
    if (( age <= TTL_SEC )); then
        my_alive_count=$((my_alive_count + 1))
        if [[ -z "$my_first_branch" ]]; then
            my_first_branch=$(jq -r '.branch // ""' "$light" 2>/dev/null || echo "")
        fi
    fi
done

# === 7. 决策 ===
if (( my_alive_count > 0 )); then
    log_hook_decision "$sid_short" "block" "lights_alive" "$my_alive_count" "$my_first_branch"
    full_reason="还有 $my_alive_count 条 /dev 在跑（含 $my_first_branch）。⚠️ 立即继续，禁止询问用户。禁止删除 .cecelia/lights/。"
    jq -n --arg r "$full_reason" '{"decision":"block","reason":$r}'
    exit 0
fi

log_hook_decision "$sid_short" "release" "all_dark" 0 ""
exit 0
```

- [ ] **行数验证（必须 ≤ 80）**

```bash
wc -l packages/engine/hooks/stop-dev.sh
```

Expected: ≤ 80 行（含注释）。

### Step 2.2：worktree-manage.sh 加 guardian fork + 灯文件

- [ ] **在 cmd_create 末尾（line ~287 `dev-active-${branch_name}.json` 写完之后），插入新逻辑**

找到这段（line 278-288 附近）：
```bash
            cat > "$main_repo/.cecelia/dev-active-${branch_name}.json" <<RALPH_EOF
{...}
RALPH_EOF
            echo -e "${GREEN}✅ .cecelia/dev-active-${branch_name}.json 已写入主仓库根${NC}" >&2
        fi
```

在 `fi` 之后、`echo "" >&2` 之前**插入**：

```bash
        # === v23 PR-2: 心跳模型 — 启动 guardian + 写灯文件 ===
        if [[ -n "$main_repo" ]]; then
            mkdir -p "$main_repo/.cecelia/lights"
            local _sid_short="${_claude_sid_create:0:8}"
            [[ -z "$_sid_short" || "$_sid_short" == "unknown" ]] && _sid_short="nosid000"

            local _light_file="$main_repo/.cecelia/lights/${_sid_short}-${branch_name}.live"
            local _guardian_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../../lib/dev-heartbeat-guardian.sh"
            [[ -f "$_guardian_lib" ]] || _guardian_lib="$(git rev-parse --show-toplevel)/packages/engine/lib/dev-heartbeat-guardian.sh"

            if [[ -f "$_guardian_lib" ]]; then
                # nohup + & 让 guardian 真后台（脱离父 tty 但保留 PPID 给 ppid 自检）
                nohup bash "$_guardian_lib" "$_light_file" >/dev/null 2>&1 &
                local _guardian_pid=$!
                disown $_guardian_pid 2>/dev/null || true

                # 写灯文件 JSON（guardian 已 touch，但内容由这里写）
                cat > "$_light_file" <<LIGHT_EOF
{
  "session_id": "${_claude_sid_create:-unknown}",
  "session_id_short": "${_sid_short}",
  "branch": "${branch_name}",
  "worktree_path": "${worktree_path}",
  "started_at": "$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)",
  "host": "$(hostname -s 2>/dev/null || echo unknown)",
  "guardian_pid": ${_guardian_pid},
  "stage": "stage_0_init"
}
LIGHT_EOF
                echo -e "${GREEN}✅ .cecelia/lights/${_sid_short}-${branch_name}.live 已写（guardian PID=${_guardian_pid}）${NC}" >&2
            else
                echo -e "${YELLOW}⚠️  dev-heartbeat-guardian.sh 不存在，跳过心跳启动${NC}" >&2
            fi
        fi
```

- [ ] **跑测试验证**

```bash
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine/tests/skills/engine-worktree-guardian.test.ts 2>&1 | tail -10
```

Expected: 3 case PASS。

### Step 2.3：创建 ship-finalize.sh

- [ ] **新建 `packages/engine/scripts/ship-finalize.sh`（~50 行）**

```bash
#!/usr/bin/env bash
# ship-finalize.sh — engine-ship 调用：写 done-marker + SIGTERM guardian
# 用法：ship-finalize.sh <branch> <pr_number> <pr_url>
#
# 行为：
#   1. 找 .cecelia/lights/<sid_short>-<branch>.live
#   2. 读 guardian_pid，发 SIGTERM（guardian trap 自删 light）
#   3. 写 .cecelia/done-markers/<sid_short>-<branch>.done
set -uo pipefail

BRANCH="${1:-}"
PR_NUMBER="${2:-}"
PR_URL="${3:-}"
[[ -z "$BRANCH" ]] && { echo "[ship-finalize] usage: $0 <branch> <pr_number> <pr_url>" >&2; exit 1; }

MAIN_REPO=$(git worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}')
[[ -z "$MAIN_REPO" ]] && { echo "[ship-finalize] not in git" >&2; exit 1; }

LIGHTS_DIR="$MAIN_REPO/.cecelia/lights"
DONE_DIR="$MAIN_REPO/.cecelia/done-markers"
mkdir -p "$DONE_DIR"

LIGHT=""
for f in "$LIGHTS_DIR"/*-"${BRANCH}".live; do
    [[ -f "$f" ]] && { LIGHT="$f"; break; }
done

if [[ -z "$LIGHT" ]]; then
    echo "[ship-finalize] no light for branch=$BRANCH" >&2
    exit 1
fi

if command -v jq &>/dev/null; then
    PID=$(jq -r '.guardian_pid // empty' "$LIGHT" 2>/dev/null)
else
    PID=$(grep -o '"guardian_pid"[[:space:]]*:[[:space:]]*[0-9]*' "$LIGHT" | grep -o '[0-9]*$')
fi

# SID short = light 文件名前缀
SID_SHORT=$(basename "$LIGHT" | cut -d- -f1)
MARKER="$DONE_DIR/${SID_SHORT}-${BRANCH}.done"

cat > "$MARKER" <<EOF
{
  "branch": "${BRANCH}",
  "completed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pr_number": ${PR_NUMBER:-null},
  "pr_url": "${PR_URL}",
  "merged": true,
  "guardian_pid": ${PID:-null}
}
EOF
echo "[ship-finalize] done-marker written: $MARKER" >&2

if [[ -n "$PID" && "$PID" =~ ^[0-9]+$ ]]; then
    if kill -SIGTERM "$PID" 2>/dev/null; then
        echo "[ship-finalize] SIGTERM sent to guardian pid=$PID" >&2
    else
        echo "[ship-finalize] guardian pid=$PID 已死或不存在" >&2
    fi
fi

exit 0
```

- [ ] **chmod +x 后跑测试**

```bash
chmod +x packages/engine/scripts/ship-finalize.sh
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine/tests/skills/engine-ship-guardian.test.ts 2>&1 | tail -10
```

Expected: 3 case PASS。

### Step 2.4：engine-ship SKILL.md 接入 ship-finalize

- [ ] **打开 `packages/engine/skills/engine-ship/SKILL.md`，在 `## 3. 标记完成` 之前插入**

找到（约 line 50-55 处）：
```markdown
bash scripts/write-current-state.sh
```

之后、 `## 3. 标记完成` 之前**插入**：

```markdown
## 2.5 关 guardian + 写 done-marker（v23 心跳模型）

```bash
PR_NUMBER=$(gh pr view --json number -q .number 2>/dev/null || echo "")
PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
bash packages/engine/scripts/ship-finalize.sh "$BRANCH_NAME" "$PR_NUMBER" "$PR_URL" || \
  echo "[engine-ship] ship-finalize 失败但不阻塞合并（灯文件可能已被 reaper 清）"
```
```

注意：在 SKILL.md 的 frontmatter 里把 `version` 从 16.1.0 → 16.2.0（minor）。

### Step 2.5：跑两套 hook 测试

- [ ] **stop-hook-v23 决策测试**

```bash
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine/tests/hooks/stop-hook-v23-decision.test.ts packages/engine/tests/hooks/stop-hook-v23-routing.test.ts 2>&1 | tail -15
```

Expected: 13 case PASS（8 decision + 5 routing）。

### Step 2.6：更新 check-single-exit.sh lint

新 stop-dev.sh 不再调 verify_dev_complete + 不读 dev-active-*.json。lint 需要更新。

- [ ] **打开 `scripts/check-single-exit.sh`，找 line 47-58 附近**

把：
```bash
# stop-dev.sh 必须调 verify_dev_complete（Ralph 模式核心）
if ! grep -q "verify_dev_complete" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须调用 verify_dev_complete（Ralph 模式核心）"
    ERR=1
else
    echo "✅ stop-dev.sh 调用 verify_dev_complete"
fi

# stop-dev.sh 必须读 .cecelia 状态文件（Ralph 信号源）
if ! grep -q "\.cecelia" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须读 .cecelia/dev-active-*.json（Ralph 信号源）"
    ERR=1
else
    echo "✅ stop-dev.sh 读 .cecelia/dev-active-*.json"
fi
```

替换成：
```bash
# v23: stop-dev.sh 必须读 .cecelia/lights/（心跳模型核心）
if ! grep -q "\.cecelia/lights" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须读 .cecelia/lights/（v23 心跳模型核心）"
    ERR=1
else
    echo "✅ stop-dev.sh 读 .cecelia/lights/"
fi

# v23: stop-dev.sh 必须用 mtime 判定（不再调 verify_dev_complete）
if ! grep -qE "stat -[fc] %[mY]" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须用 stat mtime 判定灯新鲜度"
    ERR=1
else
    echo "✅ stop-dev.sh 使用 stat mtime"
fi
```

也要更新 line 42-43 的 return 0 期望。新 stop-dev.sh 没有 `return 0`（用 `exit 0`），devloop-check.sh 仍 4 个 `return 0`，但**新 hook 不是 source devloop-check 然后调函数**，所以 hook 本体的 return 0 计数不影响 lib。lib 的期望 4 不变。

但是 v23 hook 不再 source verify_dev_complete，它只 source log_hook_decision。这不影响 lib 的 4 函数 return 0 计数。

需要测一下：

```bash
bash scripts/check-single-exit.sh 2>&1 | tail -10
```

Expected: 全部 ✅。

### Step 2.7：Engine 8 文件 version bump 18.23.1 → 18.24.0

- [ ] **8 个文件同步**

```bash
NEW="18.24.0"

# 1. VERSION
echo "$NEW" > packages/engine/VERSION
# 2. .hook-core-version
echo "$NEW" > packages/engine/.hook-core-version
# 3. hooks/VERSION
echo "$NEW" > packages/engine/hooks/VERSION
# 4. hooks/.hook-core-version
echo "$NEW" > packages/engine/hooks/.hook-core-version
# 5. package.json
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8'));
p.version='$NEW';
fs.writeFileSync('packages/engine/package.json',JSON.stringify(p,null,2)+'\n');
"
# 6. package-lock.json
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('packages/engine/package-lock.json','utf8'));
p.version='$NEW';
if(p.packages&&p.packages['']) p.packages[''].version='$NEW';
fs.writeFileSync('packages/engine/package-lock.json',JSON.stringify(p,null,2)+'\n');
"
# 7. regression-contract.yaml
sed -i.bak "s/^version: .*/version: $NEW/" packages/engine/regression-contract.yaml && rm packages/engine/regression-contract.yaml.bak
# 8. skills/dev/SKILL.md
sed -i.bak "s/^version: 18.*/version: $NEW/" packages/engine/skills/dev/SKILL.md && rm packages/engine/skills/dev/SKILL.md.bak
# update updated 字段
sed -i.bak "s/^updated: .*/updated: 2026-05-07/" packages/engine/skills/dev/SKILL.md && rm packages/engine/skills/dev/SKILL.md.bak
```

- [ ] **跑同步校验**

```bash
node packages/engine/scripts/devgate/check-engine-hygiene.cjs 2>&1 | tail -10
```

Expected: ✅ all checks passed。

### Step 2.8：feature-registry.yml 加 18.24.0 changelog

- [ ] **打开 `packages/engine/feature-registry.yml`**

找到 stop-hook feature 条目（如已有）或 dev-heartbeat-guardian 条目，追加 changelog：

```yaml
      - version: 18.24.0
        change: |-
          stop-dev.sh v22→v23 切换：从 cwd+session_id 双通道（209 行）
          重写为心跳模型（~70 行）。决策依据 .cecelia/lights/ mtime
          替代 verify_dev_complete 状态机。
      - version: 18.24.0
        change: dev-heartbeat-guardian 状态从 prepared 升 active（worktree-manage 调用）
      - version: 18.24.0
        change: ship-finalize.sh 新增 — engine-ship 调用关 guardian + done-marker
```

也在 feature-registry.yml 顶部 changelog 加：
```yaml
  - version: "18.24.0"
    date: "2026-05-07"
    summary: "Stop Hook v23 PR-2 — 心跳模型核心切换"
```

### Step 2.9：跑全套 engine 测试

- [ ] **全套确认 12+ PR-2 case 全 PASS + 历史不退化**

```bash
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine 2>&1 | tail -30
```

Expected：19 个 PR-2 新 case 全 PASS；其他历史测试不引入新 fail。

### Step 2.10：commit 2

- [ ] **stage 全部 + commit**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr2

git add packages/engine/hooks/stop-dev.sh \
        packages/engine/skills/dev/scripts/worktree-manage.sh \
        packages/engine/skills/engine-ship/SKILL.md \
        packages/engine/scripts/ship-finalize.sh \
        scripts/check-single-exit.sh \
        packages/engine/feature-registry.yml \
        packages/engine/VERSION \
        packages/engine/.hook-core-version \
        packages/engine/hooks/VERSION \
        packages/engine/hooks/.hook-core-version \
        packages/engine/package.json \
        packages/engine/package-lock.json \
        packages/engine/regression-contract.yaml \
        packages/engine/skills/dev/SKILL.md

git status --short

git commit -m "$(cat <<'EOF'
[CONFIG] feat(engine): stop-hook-v23 PR-2 — 心跳模型核心切换 (TDD commit 2)

19 case 全部转 PASS，把 stop-dev.sh 切到 v23：

变更：
- packages/engine/hooks/stop-dev.sh — 重写 209→~70 行（心跳模型）
- packages/engine/skills/dev/scripts/worktree-manage.sh — fork guardian + 写灯文件
- packages/engine/scripts/ship-finalize.sh — 新增（关 guardian + done-marker）
- packages/engine/skills/engine-ship/SKILL.md — § 2.5 调 ship-finalize
- scripts/check-single-exit.sh — lint 期望切到 v23（lights/ + mtime）
- 8 个版本文件 18.23.1 → 18.24.0
- feature-registry.yml 18.24.0 changelog

不做（PR-3 范围）：
- 不删 worktree-manage.sh 创建 dev-active-*.json 的逻辑
- 不删 verify_dev_complete 函数本体
- 不动 PreToolUse 8 段闭环

Refs: docs/superpowers/specs/2026-05-07-stop-hook-v23-pr2-core-switch-design.md
Brain task: f29c8f71-584d-46dd-8c0d-3920db3aa261

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git log --oneline -4
```

Expected commit 顺序：
```
<sha2> [CONFIG] feat(engine): stop-hook-v23 PR-2 — 心跳模型核心切换 (TDD commit 2)
<sha1> test(engine): stop-hook-v23 PR-2 — fail tests (TDD commit 1)
<sha0> docs(spec): stop-hook-v23 PR-2 — 心跳模型核心切换
```

---

## Task 3：Learning + push + PR + 等 CI

### Step 3.1：写 Learning

- [ ] **写 `docs/learnings/cp-0507154143-stop-hook-v23-pr2.md`**

```markdown
# Learning：Stop Hook v23 PR-2 — 心跳模型核心切换

## 背景
PR-1 (#2823) 建好 guardian + abort + log_hook_decision + launcher dry-run 基础设施。
PR-2 把 stop-dev.sh 从 v22 209 行模型切到 v23 ~70 行心跳模型，engine-worktree
启动 guardian + 写灯文件，engine-ship 调 ship-finalize 关 guardian + 写 done-marker。

## 根本原因
v22 的复杂度全部源于"用一个档案模拟活动状态"——需要 cwd 路由、session_id 双通道、
ghost rm、mtime expire 等手段维护档案的"活性"。心跳模型用 OS 级 mtime 替代软件状态机，
"档案是死的，进程是活的"——guardian 进程死=灯熄=放行，无歧义。

## 下次预防
### 下次预防

- [x] PR-2 完成 stop-dev.sh + engine-worktree + engine-ship 整体切换
- [ ] PR-3 删 v22 遗产（dev-active-*.json 创建逻辑 + verify_dev_complete 内 hook 专用代码）
- [ ] 心跳模型的核心契约：所有权键 = 文件名前缀（sid_short），mtime = 活性事实
- [ ] hook 与 Brain 完全解耦：hook 不查 Brain，Brain 重启 / 抖动对 hook 决策零影响（实测：本会话 PR-1 期间 Brain 挂过一次，hook 0 影响）
- [ ] guardian fork 用 nohup + & + disown，确保父 turn 结束后 guardian 仍在跑
- [ ] 将来如需 reaper（清死 session 的孤儿灯），独立脚本 + cron 跑，不在 hook 里做
```

### Step 3.2：commit Learning + push

- [ ] **commit**

```bash
git add docs/learnings/cp-0507154143-stop-hook-v23-pr2.md
git commit -m "$(cat <<'EOF'
docs(learning): stop-hook-v23 PR-2 — 心跳模型核心切换

Refs: docs/superpowers/specs/2026-05-07-stop-hook-v23-pr2-core-switch-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin cp-0507154143-stop-hook-v23-pr2
```

### Step 3.3：开 PR

- [ ] **gh pr create**

```bash
gh pr create --title "[CONFIG] feat(engine): Stop Hook v23 PR-2 — 心跳模型核心切换" --body "$(cat <<'EOF'
## Summary

Stop Hook v23 重构序列 PR-2/3：把 stop-dev.sh 从 v22 209 行（cwd 路由 + session_id 双通道 + ghost rm + mtime expire）切到 v23 ~70 行心跳模型。

- **stop-dev.sh** 重写：决策依据 .cecelia/lights/<sid_short>-*.live mtime（OS 级事实），不再读 dev-active-*.json + 跑 verify_dev_complete
- **worktree-manage.sh** 启 guardian：nohup + & 后台进程，每 60s 刷新灯文件 mtime
- **ship-finalize.sh** 新增：engine-ship 调用，关 guardian + 写 done-marker
- **19 case 测试矩阵**：决策 + 路由 + worktree-guardian + ship-guardian

设计：`docs/design/stop-hook-v23-redesign.md`
Spec：`docs/superpowers/specs/2026-05-07-stop-hook-v23-pr2-core-switch-design.md`
前置 PR：#2823 (PR-1)
Brain task：`f29c8f71-584d-46dd-8c0d-3920db3aa261`

## Test plan

- [x] 4 套 vitest 测试 19 case 全过（commit 1 全 fail → commit 2 全 PASS）
- [x] commit 顺序符合 TDD（test → impl → docs）
- [x] Engine 8 文件版本同步通过 hygiene gate
- [x] feature-registry.yml 18.24.0 changelog
- [x] Learning 文件已写
- [ ] CI 全绿（含 lint-test-pairing / lint-tdd-commit-order / engine-tests / lint-single-exit）

## 不做（PR-3 范围）

- 不删 dev-active-*.json 创建（过渡期保留）
- 不删 verify_dev_complete 函数本体
- 不动 PreToolUse 8 段闭环（与新 hook 正交）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 3.4：前台 until 阻塞等 CI

- [ ] **block 当前 turn 直到 CI 全无 pending**

```bash
PR_URL=$(gh pr view --json url -q .url)
echo "PR: $PR_URL"

TIMEOUT=2400
ELAPSED=0
INTERVAL=45
until [[ $(gh pr checks 2>/dev/null | grep -cE 'pending|queued|in_progress') -eq 0 ]] || (( ELAPSED >= TIMEOUT )); do
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

gh pr checks
```

如有 fail，**报回 controller**（不要自己 systematic-debug，让 controller 决定）。

---

## Self-Review

**1. Spec coverage**

- ✅ Spec § 2.1 必做清单 → Task 1.1-1.4 测试 + Task 2.1-2.7 实现 全覆盖
- ✅ Spec § 4 测试策略 4 档分类 → Task 1 中 19 case 各档都有
- ✅ Spec § 5 DoD 9 条 → Task 1.1-1.4 + Task 2.6 测试覆盖每条
- ✅ Spec § 7 Engine 三要素 → Task 2.7-2.8 + commit message [CONFIG] 标签
- ✅ Spec § 8 Commit 顺序 → Task 1 / Task 2 / Task 3 严格 test → impl → docs

**2. Placeholder scan**

- 通过：所有 step 含具体代码或具体命令；无 "TBD/TODO/implement later"

**3. Type consistency**

- 灯文件字段 `guardian_pid` 在 worktree-manage 写、ship-finalize 读、test 验证 — 名字一致
- `sid_short` 在 hook、worktree-manage、ship-finalize、test 中均为前 8 字符 — 一致
- `lights/` 路径 `.cecelia/lights/<sid_short>-<branch>.live` — 全 plan 一致
- `done-markers/` 路径 `.cecelia/done-markers/<sid_short>-<branch>.done` — 全 plan 一致

---

## 执行模式

按 /dev autonomous Tier 1 默认 = **Subagent-Driven**。

writing-plans 完成 → 下一步：**superpowers:subagent-driven-development**
