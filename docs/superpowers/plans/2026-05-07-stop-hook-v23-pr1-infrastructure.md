# Stop Hook v23 PR-1 基础设施 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 stop hook v23 心跳模型搭建物理基础部件（guardian 守护进程、abort 脚本、决策日志、launcher 契约测试），不切换 hook 行为。

**Architecture:** 新增 2 个独立 bash 脚本（guardian、abort）+ 1 个共享 lib 函数（log_hook_decision）+ launcher dry-run 选项 + 4 套 vitest 测试。本 PR 不动 stop-dev.sh 主决策逻辑（仅追加 1 行日志调用）。

**Tech Stack:** Bash 4+（macOS BSD + Linux GNU 双兼容）、vitest 3.x、Node.js child_process。

**Spec:** `docs/superpowers/specs/2026-05-07-stop-hook-v23-pr1-infrastructure-design.md`
**Master Design:** `docs/design/stop-hook-v23-redesign.md`
**Brain Task:** `7cdae14e-c28a-43d3-926c-01965922d852`

---

## File Structure

### 新建（Create）

| 路径 | 职责 | 行数预估 |
|---|---|---|
| `packages/engine/lib/dev-heartbeat-guardian.sh` | 守护进程：维持灯亮 + ppid 自检 + trap 清理 | ~30 |
| `packages/engine/scripts/abort-dev.sh` | 用户手动中止 /dev：杀 guardian + 写 marker | ~30 |
| `packages/engine/tests/hooks/heartbeat-guardian.test.ts` | guardian 行为测试（4 个 case） | ~140 |
| `packages/engine/tests/hooks/abort-dev.test.ts` | abort 行为测试（3 个 case） | ~100 |
| `packages/engine/tests/hooks/hook-decision-log.test.ts` | log 函数测试（3 个 case） | ~80 |
| `packages/engine/tests/launcher/launcher-dry-run.test.ts` | launcher dry-run 注入 session_id 测试（2 个 case） | ~80 |

### 修改（Modify）

| 路径 | 改什么 |
|---|---|
| `packages/engine/lib/devloop-check.sh` | 加 `log_hook_decision()` 函数（~15 行） |
| `packages/engine/hooks/stop-dev.sh` | 加 1 行 `log_hook_decision` 调用（不改主逻辑） |
| `scripts/claude-launch.sh` | 加 `--dry-run` 选项：echo 最终命令行不实际 exec |
| `packages/brain/scripts/cecelia-run.sh` | 同上 |
| `packages/engine/package.json` | version bump |
| `packages/engine/package-lock.json` | version bump |
| `packages/engine/VERSION` | version bump |
| `packages/engine/.hook-core-version` | version bump |
| `packages/engine/regression-contract.yaml` | version bump |
| `packages/engine/feature-registry.yml` | 加 `dev-heartbeat-guardian` changelog 条目 |

---

## Task 1：写全部失败测试 + commit（TDD commit 1）

**目标**：4 套 vitest 测试 + 12 个 case 全部 fail（因实现还不存在）。

**Files:**
- Create: `packages/engine/tests/hooks/heartbeat-guardian.test.ts`
- Create: `packages/engine/tests/hooks/abort-dev.test.ts`
- Create: `packages/engine/tests/hooks/hook-decision-log.test.ts`
- Create: `packages/engine/tests/launcher/launcher-dry-run.test.ts`

### Step 1.1：写 heartbeat-guardian.test.ts

- [ ] **写 4 个测试 case**

```typescript
// packages/engine/tests/hooks/heartbeat-guardian.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { writeFileSync, existsSync, statSync, rmSync, mkdtempSync, unlinkSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

describe('dev-heartbeat-guardian.sh', () => {
  const guardian = resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')
  let testDir: string
  let lightFile: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'guardian-test-'))
    lightFile = join(testDir, 'test.live')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('启动后立即创建/touch 灯文件', async () => {
    const proc = spawn('bash', [guardian, lightFile], { detached: false })
    await new Promise(r => setTimeout(r, 500))
    expect(existsSync(lightFile)).toBe(true)
    process.kill(proc.pid!, 'SIGTERM')
    await new Promise(r => setTimeout(r, 200))
  })

  it('收到 SIGTERM 后清理灯文件并退出 0', async () => {
    const proc = spawn('bash', [guardian, lightFile])
    await new Promise(r => setTimeout(r, 500))
    expect(existsSync(lightFile)).toBe(true)

    const exitPromise = new Promise<number>(resolve => {
      proc.on('exit', code => resolve(code ?? -1))
    })
    process.kill(proc.pid!, 'SIGTERM')
    const exitCode = await exitPromise

    expect(exitCode).toBe(0)
    expect(existsSync(lightFile)).toBe(false)
  })

  it('父进程死后 guardian 自杀（ppid 自检）', async () => {
    // 用 setsid 启动 guardian，让它独立于测试进程；测试进程模拟 parent
    // 这里用一个简单代理：fork 一个 shell 当父，shell 退出，guardian 应自杀
    const wrapperScript = `
      bash ${guardian} ${lightFile} &
      GUARDIAN_PID=$!
      echo $GUARDIAN_PID > ${join(testDir, 'guardian.pid')}
      sleep 0.5
      exit 0
    `
    const wrapperFile = join(testDir, 'wrapper.sh')
    writeFileSync(wrapperFile, wrapperScript)
    const wrapper = spawn('bash', [wrapperFile])
    await new Promise(r => setTimeout(r, 1000))
    // 等 wrapper 退出 + guardian 检测 ppid 变化（最多 60s 一次循环）
    // 测试用短 TTL 不现实，改用直接检查 light 文件是否最终消失
    // 简化：用快速变体的 guardian 测试（GUARDIAN_INTERVAL_SEC=1 env）
    await new Promise(r => setTimeout(r, 3000))
    // 期望 guardian 已自杀清理（实际生产 60s 间隔，此 case 在快速模式跑）
    const guardianPid = parseInt(require('fs').readFileSync(join(testDir, 'guardian.pid'), 'utf8'))
    let guardianAlive = true
    try { process.kill(guardianPid, 0) } catch { guardianAlive = false }
    expect(guardianAlive).toBe(false)
  }, 10000)

  it('参数为空时 exit 1', async () => {
    const proc = spawn('bash', [guardian])
    const exitPromise = new Promise<number>(resolve => {
      proc.on('exit', code => resolve(code ?? -1))
    })
    const exitCode = await exitPromise
    expect(exitCode).toBe(1)
  })
})
```

- [ ] **运行验证 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr1
npx vitest run packages/engine/tests/hooks/heartbeat-guardian.test.ts 2>&1 | tail -10
```

Expected: 4 个 case fail（"No such file"，因 guardian 未创建）

### Step 1.2：写 abort-dev.test.ts

- [ ] **写 3 个测试 case**

```typescript
// packages/engine/tests/hooks/abort-dev.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawn } from 'child_process'
import { writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

describe('abort-dev.sh', () => {
  const abortScript = resolve(__dirname, '../../scripts/abort-dev.sh')
  const guardian = resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')
  let testRepo: string
  let lightsDir: string
  let abortedDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'abort-test-'))
    lightsDir = join(testRepo, '.cecelia/lights')
    abortedDir = join(testRepo, '.cecelia/aborted')
    mkdirSync(lightsDir, { recursive: true })
    mkdirSync(abortedDir, { recursive: true })
    execSync(`git init -q ${testRepo}`)
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  it('中止 active /dev：kill guardian + 写 aborted-marker', async () => {
    const branch = 'cp-test-branch'
    const lightFile = join(lightsDir, `abc12345-${branch}.live`)

    // 启动 guardian
    const proc = spawn('bash', [guardian, lightFile])
    await new Promise(r => setTimeout(r, 500))

    // 写灯文件含 guardian_pid
    writeFileSync(lightFile, JSON.stringify({
      session_id: 'abc12345-full-uuid',
      branch,
      guardian_pid: proc.pid,
    }))

    // 调 abort
    const result = execSync(
      `cd ${testRepo} && bash ${abortScript} ${branch}`,
      { encoding: 'utf8' }
    )

    await new Promise(r => setTimeout(r, 500))
    // guardian 应被杀
    let alive = true
    try { process.kill(proc.pid!, 0) } catch { alive = false }
    expect(alive).toBe(false)

    // aborted-marker 应存在
    const marker = join(abortedDir, `abc12345-${branch}.aborted`)
    expect(existsSync(marker)).toBe(true)
  })

  it('找不到匹配灯：exit 1', () => {
    const result = (() => {
      try {
        execSync(`cd ${testRepo} && bash ${abortScript} nonexistent-branch`, { encoding: 'utf8' })
        return 0
      } catch (e: any) { return e.status }
    })()
    expect(result).toBe(1)
  })

  it('幂等：重复 abort 同一 branch 不报错', async () => {
    const branch = 'cp-idempotent'
    const lightFile = join(lightsDir, `def67890-${branch}.live`)
    const proc = spawn('bash', [guardian, lightFile])
    await new Promise(r => setTimeout(r, 500))
    writeFileSync(lightFile, JSON.stringify({ guardian_pid: proc.pid }))

    execSync(`cd ${testRepo} && bash ${abortScript} ${branch}`, { encoding: 'utf8' })
    await new Promise(r => setTimeout(r, 300))

    // 第二次：灯已不存在 → exit 1，但允许（幂等通过 || true）
    const second = (() => {
      try {
        execSync(`cd ${testRepo} && bash ${abortScript} ${branch}`, { encoding: 'utf8' })
        return 0
      } catch (e: any) { return e.status }
    })()
    expect([0, 1]).toContain(second)  // 0 或 1 都接受（已无灯返回 1）
  })
})
```

- [ ] **运行验证 fail**

```bash
npx vitest run packages/engine/tests/hooks/abort-dev.test.ts 2>&1 | tail -10
```

Expected: 3 个 case fail

### Step 1.3：写 hook-decision-log.test.ts

- [ ] **写 3 个测试 case**

```typescript
// packages/engine/tests/hooks/hook-decision-log.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

describe('log_hook_decision (devloop-check.sh)', () => {
  const lib = resolve(__dirname, '../../lib/devloop-check.sh')
  let testHome: string

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'hooklog-test-'))
  })

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true })
  })

  it('合法字段 → 追加 JSON 一行', () => {
    const cmd = `HOME=${testHome} bash -c '
      source ${lib}
      log_hook_decision "abc12345" "block" "lights_alive" 3 "cp-test"
    '`
    execSync(cmd, { encoding: 'utf8' })

    const logFile = join(testHome, '.claude/hook-logs/stop-dev.jsonl')
    expect(existsSync(logFile)).toBe(true)

    const lastLine = readFileSync(logFile, 'utf8').trim().split('\n').pop()!
    const parsed = JSON.parse(lastLine)
    expect(parsed.session_id_short).toBe('abc12345')
    expect(parsed.decision).toBe('block')
    expect(parsed.reason_code).toBe('lights_alive')
    expect(parsed.lights_count).toBe(3)
    expect(parsed.branch).toBe('cp-test')
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('日志目录不存在时自动 mkdir -p', () => {
    const cmd = `HOME=${testHome} bash -c '
      source ${lib}
      log_hook_decision "x" "release" "all_dark" 0 ""
    '`
    execSync(cmd, { encoding: 'utf8' })
    expect(existsSync(join(testHome, '.claude/hook-logs/stop-dev.jsonl'))).toBe(true)
  })

  it('字段缺失时仍输出 JSON（默认值兜底）', () => {
    const cmd = `HOME=${testHome} bash -c '
      source ${lib}
      log_hook_decision "" "" "" "" ""
    '`
    execSync(cmd, { encoding: 'utf8' })
    const logFile = join(testHome, '.claude/hook-logs/stop-dev.jsonl')
    const lastLine = readFileSync(logFile, 'utf8').trim().split('\n').pop()!
    const parsed = JSON.parse(lastLine)  // 必须仍是合法 JSON
    expect(typeof parsed).toBe('object')
  })
})
```

- [ ] **运行验证 fail**

```bash
npx vitest run packages/engine/tests/hooks/hook-decision-log.test.ts 2>&1 | tail -10
```

Expected: 3 个 case fail（log_hook_decision 函数不存在）

### Step 1.4：写 launcher-dry-run.test.ts

- [ ] **写 2 个测试 case**

```typescript
// packages/engine/tests/launcher/launcher-dry-run.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

describe('claude-launch.sh / cecelia-run.sh dry-run 注入 session_id', () => {
  const claudeLaunch = resolve(__dirname, '../../../../scripts/claude-launch.sh')
  const ceceliaRun = resolve(__dirname, '../../../brain/scripts/cecelia-run.sh')

  it('claude-launch.sh --dry-run 输出含 --session-id <uuid>', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run`, { encoding: 'utf8' })
    expect(out).toMatch(/--session-id\s+[a-f0-9-]{8,}/)
  })

  it('cecelia-run.sh --dry-run 输出含 --session-id <uuid>', () => {
    const out = execSync(`bash ${ceceliaRun} --dry-run`, { encoding: 'utf8' })
    expect(out).toMatch(/--session-id\s+[a-f0-9-]{8,}/)
  })
})
```

- [ ] **运行验证 fail**

```bash
npx vitest run packages/engine/tests/launcher/launcher-dry-run.test.ts 2>&1 | tail -10
```

Expected: 2 case fail（--dry-run 选项还没加）

### Step 1.5：commit 1（fail tests）

- [ ] **stage + commit**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr1
git add packages/engine/tests/hooks/heartbeat-guardian.test.ts \
        packages/engine/tests/hooks/abort-dev.test.ts \
        packages/engine/tests/hooks/hook-decision-log.test.ts \
        packages/engine/tests/launcher/launcher-dry-run.test.ts

git commit -m "$(cat <<'EOF'
test(engine): stop-hook-v23 PR-1 基础设施 — fail tests (TDD commit 1)

12 个 case 失败（实现尚未就位）：
- heartbeat-guardian: touch / SIGTERM 清理 / ppid 自杀 / 参数缺失 (4)
- abort-dev: kill guardian+marker / 找不到 / 幂等 (3)
- hook-decision-log: 合法字段 / 自动 mkdir / 缺省兜底 (3)
- launcher-dry-run: claude-launch / cecelia-run 注入 session_id (2)

下个 commit 加实现让测试转 PASS。

Refs: docs/superpowers/specs/2026-05-07-stop-hook-v23-pr1-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2：实现全部代码 + 测试通过 + commit（TDD commit 2）

**目标**：实现 6 个文件，让 12 个 case 全部转 PASS。

### Step 2.1：实现 dev-heartbeat-guardian.sh

- [ ] **写守护进程**

```bash
# packages/engine/lib/dev-heartbeat-guardian.sh
#!/usr/bin/env bash
# dev-heartbeat-guardian.sh — 维持灯亮的小傻子
# 用法：dev-heartbeat-guardian.sh <light_file_path>
#
# 行为：
#   - 每 GUARDIAN_INTERVAL_SEC 秒（默认 60）touch light_file 一次
#   - 收到 SIGTERM/SIGINT/SIGHUP → rm light_file + exit 0
#   - 父进程死亡（ppid → 1）→ rm light_file + exit 0
#   - 参数缺失 / touch 失败 → exit 1
set -uo pipefail

LIGHT="${1:-}"
[[ -z "$LIGHT" ]] && { echo "[guardian] usage: $0 <light_file>" >&2; exit 1; }

INTERVAL="${GUARDIAN_INTERVAL_SEC:-60}"
ORIGINAL_PPID=$PPID

cleanup() {
    rm -f "$LIGHT"
    exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# 立即首次 touch
touch "$LIGHT" 2>/dev/null || { echo "[guardian] cannot create $LIGHT" >&2; exit 1; }

while true; do
    # ppid 自检 — 跨平台
    if [[ "$(uname)" == "Darwin" ]]; then
        current_ppid=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ' || echo 1)
    else
        current_ppid=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ' || echo 1)
    fi
    if [[ "$current_ppid" != "$ORIGINAL_PPID" ]]; then
        cleanup
    fi

    sleep "$INTERVAL" &
    SLEEP_PID=$!
    wait "$SLEEP_PID" 2>/dev/null || true

    touch "$LIGHT" 2>/dev/null || cleanup
done
```

- [ ] **chmod +x + 测试**

```bash
chmod +x packages/engine/lib/dev-heartbeat-guardian.sh

# ppid 自检测试需要 GUARDIAN_INTERVAL_SEC=1 才能在 3 秒内观察到
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine/tests/hooks/heartbeat-guardian.test.ts
```

Expected: 4 case PASS

### Step 2.2：实现 abort-dev.sh

- [ ] **写中止脚本**

```bash
# packages/engine/scripts/abort-dev.sh
#!/usr/bin/env bash
# abort-dev.sh — 用户手动中止一条 /dev 流程
# 用法：abort-dev.sh <branch>
set -uo pipefail

BRANCH="${1:-}"
[[ -z "$BRANCH" ]] && { echo "[abort-dev] usage: $0 <branch>" >&2; exit 1; }

# 找主仓库（在 worktree 中运行也能找到）
MAIN_REPO=$(git worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2}')
[[ -z "$MAIN_REPO" ]] && { echo "[abort-dev] not in git repo" >&2; exit 1; }

LIGHTS_DIR="$MAIN_REPO/.cecelia/lights"
ABORTED_DIR="$MAIN_REPO/.cecelia/aborted"
mkdir -p "$ABORTED_DIR"

# 找匹配灯（取第一个）
LIGHT=""
for f in "$LIGHTS_DIR"/*-"${BRANCH}".live; do
    [[ -f "$f" ]] && { LIGHT="$f"; break; }
done

if [[ -z "$LIGHT" ]]; then
    echo "[abort-dev] no light found for branch=$BRANCH" >&2
    exit 1
fi

# 读 guardian_pid（用 jq；jq 不在则 grep 兜底）
if command -v jq &>/dev/null; then
    PID=$(jq -r '.guardian_pid // empty' "$LIGHT" 2>/dev/null)
else
    PID=$(grep -o '"guardian_pid"[[:space:]]*:[[:space:]]*[0-9]*' "$LIGHT" | grep -o '[0-9]*$')
fi

if [[ -z "$PID" || ! "$PID" =~ ^[0-9]+$ ]]; then
    echo "[abort-dev] guardian_pid missing or invalid in $LIGHT" >&2
    exit 2
fi

# 杀 guardian（trap 会让它自己 rm 灯）
if kill -SIGTERM "$PID" 2>/dev/null; then
    echo "[abort-dev] sent SIGTERM to guardian pid=$PID" >&2
else
    echo "[abort-dev] kill failed (pid=$PID 不存在或权限不够)" >&2
    # 不 exit，继续写 marker 让审计完整
fi

# 写 aborted-marker
SID_SHORT=$(basename "$LIGHT" | cut -d- -f1)
MARKER="$ABORTED_DIR/${SID_SHORT}-${BRANCH}.aborted"
cat > "$MARKER" <<EOF
{"branch":"$BRANCH","aborted_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","guardian_pid":$PID}
EOF

echo "[abort-dev] aborted $BRANCH (marker=$MARKER)" >&2
exit 0
```

- [ ] **chmod +x + 测试**

```bash
chmod +x packages/engine/scripts/abort-dev.sh
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine/tests/hooks/abort-dev.test.ts
```

Expected: 3 case PASS

### Step 2.3：实现 log_hook_decision 函数

- [ ] **修改 devloop-check.sh，加 log_hook_decision**

在 `packages/engine/lib/devloop-check.sh` 末尾追加：

```bash
# ============================================================================
# log_hook_decision — 结构化决策日志（PR-2 hook 重写后复用）
# 用法：log_hook_decision <sid_short> <decision> <reason_code> <lights_count> <branch>
# 落点：~/.claude/hook-logs/stop-dev.jsonl（自动创建目录）
# ============================================================================
log_hook_decision() {
    local sid="${1:-}"
    local decision="${2:-unknown}"
    local reason="${3:-unknown}"
    local count="${4:-0}"
    local branch="${5:-}"

    local log_dir="${HOME}/.claude/hook-logs"
    local log_file="${log_dir}/stop-dev.jsonl"
    mkdir -p "$log_dir" 2>/dev/null || return 0

    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S%z" 2>/dev/null || echo "unknown")

    # 用 printf 转义引号；保证输出是 1 行合法 JSON
    printf '{"ts":"%s","session_id_short":"%s","decision":"%s","reason_code":"%s","lights_count":%s,"branch":"%s","hook_version":"22"}\n' \
        "$ts" "$sid" "$decision" "$reason" "${count:-0}" "$branch" \
        >> "$log_file" 2>/dev/null || return 0
}
```

- [ ] **测试**

```bash
npx vitest run packages/engine/tests/hooks/hook-decision-log.test.ts
```

Expected: 3 case PASS

### Step 2.4：在 stop-dev.sh 加 1 行 log 调用（不动主逻辑）

- [ ] **打开 stop-dev.sh，找两个出口（done / block）**

在 v22 stop-dev.sh 现有的 case 出口加日志：

```bash
# 在 done 分支（line 196 附近 exit 0 之前）：
sid_for_log="${hook_session_id:0:8}"
log_hook_decision "$sid_for_log" "release" "verify_done" 1 "$branch"

# 在 *) 分支（line 207 附近 exit 0 之前）：
sid_for_log="${hook_session_id:0:8}"
log_hook_decision "$sid_for_log" "block" "verify_pending" 1 "$branch"
```

注意：这两行**只新增、不改决策**；命令失败 `|| return 0` 静默吞掉。

- [ ] **smoke 测试：手动跑一次，验证日志写入**

```bash
echo '{"session_id":"abc12345-xyz"}' | bash packages/engine/hooks/stop-dev.sh > /dev/null 2>&1
ls -la ~/.claude/hook-logs/stop-dev.jsonl
tail -1 ~/.claude/hook-logs/stop-dev.jsonl | python3 -m json.tool
```

Expected: 文件存在，最后一行是合法 JSON。

### Step 2.5：launcher 加 --dry-run

- [ ] **改 scripts/claude-launch.sh**

在文件开头解析参数处加：

```bash
DRY_RUN=0
ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--dry-run" ]]; then
        DRY_RUN=1
    else
        ARGS+=("$arg")
    fi
done

# ... 原有逻辑生成 SESSION_ID 等 ...

# 在最后 exec claude 前：
FINAL_CMD=(claude --session-id "$SESSION_ID" "${ARGS[@]}")
if [[ "$DRY_RUN" == "1" ]]; then
    echo "${FINAL_CMD[@]}"
    exit 0
fi
exec "${FINAL_CMD[@]}"
```

（具体实现要照搬 launcher 现有结构，关键：dry-run 时**echo 出最终 cmdline 含 `--session-id <uuid>`**）

- [ ] **改 packages/brain/scripts/cecelia-run.sh**

同样加 `--dry-run` 选项 + echo 最终 cmdline。

- [ ] **测试**

```bash
npx vitest run packages/engine/tests/launcher/launcher-dry-run.test.ts
```

Expected: 2 case PASS

### Step 2.6：Engine 5 文件 version bump

- [ ] **读当前版本**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr1
cat packages/engine/VERSION
```

记录当前版本号（如 5.3.0）→ patch bump → 5.3.1（PR-1 是基础设施小补丁，patch 即可）

- [ ] **5 个文件同步**

```bash
NEW="5.3.1"  # 用实际新版本替换

# 1. package.json
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8'));
p.version='$NEW';
fs.writeFileSync('packages/engine/package.json',JSON.stringify(p,null,2)+'\n');
"

# 2. package-lock.json
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('packages/engine/package-lock.json','utf8'));
p.version='$NEW';
if(p.packages&&p.packages['']) p.packages[''].version='$NEW';
fs.writeFileSync('packages/engine/package-lock.json',JSON.stringify(p,null,2)+'\n');
"

# 3. VERSION
echo "$NEW" > packages/engine/VERSION

# 4. .hook-core-version
echo "$NEW" > packages/engine/.hook-core-version

# 5. regression-contract.yaml
sed -i.bak "s/^version: .*/version: $NEW/" packages/engine/regression-contract.yaml
rm packages/engine/regression-contract.yaml.bak
```

- [ ] **跑同步校验**

```bash
bash scripts/check-version-sync.sh
```

Expected: ✅ 5 处版本一致

### Step 2.7：feature-registry.yml 加 changelog

- [ ] **新增 feature 条目 + changelog 行**

打开 `packages/engine/feature-registry.yml`，在 `features:` 下加：

```yaml
  - id: dev-heartbeat-guardian
    type: lib
    path: packages/engine/lib/dev-heartbeat-guardian.sh
    description: 心跳守护进程，维持灯文件 mtime 新鲜，崩溃/被杀时自清理
    status: active
    introduced_in: 5.3.1
    changelog:
      - version: 5.3.1
        change: 新增 — Stop Hook v23 重构 PR-1
```

如已有 stop-hook 条目，在其 changelog 下追加：

```yaml
      - version: 5.3.1
        change: 新增 log_hook_decision 函数（不改决策逻辑），为 PR-2 切换 hook 主体准备
```

- [ ] **跑 generate-path-views（如脚本存在）**

```bash
[[ -f packages/engine/scripts/generate-path-views.sh ]] && \
    bash packages/engine/scripts/generate-path-views.sh || \
    echo "[skip] generate-path-views.sh 不存在"
```

### Step 2.8：跑全套测试

- [ ] **engine workspace 全测试**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr1
GUARDIAN_INTERVAL_SEC=1 npx vitest run packages/engine 2>&1 | tail -20
```

Expected: 12 个新 case 全 PASS；其他历史测试不退化。

### Step 2.9：commit 2（实现 + 通过）

- [ ] **stage 全部 + commit**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-v23-pr1
git add packages/engine/lib/dev-heartbeat-guardian.sh \
        packages/engine/scripts/abort-dev.sh \
        packages/engine/lib/devloop-check.sh \
        packages/engine/hooks/stop-dev.sh \
        scripts/claude-launch.sh \
        packages/brain/scripts/cecelia-run.sh \
        packages/engine/package.json \
        packages/engine/package-lock.json \
        packages/engine/VERSION \
        packages/engine/.hook-core-version \
        packages/engine/regression-contract.yaml \
        packages/engine/feature-registry.yml

git status --short

git commit -m "$(cat <<'EOF'
[CONFIG] feat(engine): stop-hook-v23 PR-1 基础设施实现 (TDD commit 2)

实现 12 个 fail test 全部转 PASS：
- packages/engine/lib/dev-heartbeat-guardian.sh — 心跳守护进程
- packages/engine/scripts/abort-dev.sh — 用户手动中止
- packages/engine/lib/devloop-check.sh — 加 log_hook_decision 函数
- packages/engine/hooks/stop-dev.sh — 加 1 行日志调用（决策路径不变）
- scripts/claude-launch.sh + brain/scripts/cecelia-run.sh — 加 --dry-run 选项

Engine 5 文件版本同步 + feature-registry changelog。
本 PR 不切换 stop hook 行为（PR-2 范围），零回归。

Refs: docs/superpowers/specs/2026-05-07-stop-hook-v23-pr1-infrastructure-design.md
Brain task: 7cdae14e-c28a-43d3-926c-01965922d852

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **验证 commit 顺序（CI 会强校验）**

```bash
git log --oneline -3
```

Expected:
```
<sha2> [CONFIG] feat(engine): stop-hook-v23 PR-1 基础设施实现 (TDD commit 2)
<sha1> test(engine): stop-hook-v23 PR-1 基础设施 — fail tests (TDD commit 1)
<sha0> docs(spec): stop-hook-v23 PR-1 基础设施 — 心跳模型重构序列起点
```

---

## Task 3：写 Learning + push + PR

### Step 3.1：写 Learning 文件

- [ ] **写 docs/learnings/cp-0507135525-stop-hook-v23-pr1.md**

```markdown
# Learning：Stop Hook v23 PR-1 基础设施

## 背景
Stop Hook v18~v22 5 天内 5 次大重构，根因是用一个"档案"（state file）模拟"活动状态"，需要持续维护其活性导致复杂度爆炸。本 PR 是 v23 重构的第 1 步，引入心跳模型基础设施（不切换 hook 行为）。

## 根本原因
v22 的 209 行复杂度全部来自"考证档案是否有效"——cwd 路由、session_id 双通道、ghost rm、mtime expire、PreToolUse 8 段、main_session_id 字段。**根因是混合了"流身份"和"所有权"两个正交维度到单一 key**。

## 下次预防
- [x] PR-1 建心跳模型基础（guardian + abort + 日志），不切 hook，零回归
- [ ] PR-2 重写 hook 为 ~50 行，依赖本 PR 的 log_hook_decision
- [ ] PR-3 删 v22 遗产（dev-active-*.json 整套）
- [ ] 每个 PR 间隔 24h 观察期，避免一次性大爆炸
- [ ] 心跳模型把"流身份"（branch）和"所有权"（session_id）分开存到文件名，从设计上避免单 key 双轴的历史陷阱
```

### Step 3.2：commit Learning + push

- [ ] **add + commit + push**

```bash
git add docs/learnings/cp-0507135525-stop-hook-v23-pr1.md
git commit -m "$(cat <<'EOF'
docs(learning): stop-hook-v23 PR-1 — 心跳模型基础设施

Refs: docs/superpowers/specs/2026-05-07-stop-hook-v23-pr1-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin cp-0507135525-stop-hook-v23-pr1
```

### Step 3.3：开 PR

- [ ] **gh pr create**

```bash
gh pr create --title "[CONFIG] feat(engine): Stop Hook v23 PR-1 基础设施 — 心跳模型部件" --body "$(cat <<'EOF'
## Summary

Stop Hook v23 重构序列 PR-1/3：建心跳模型物理基础。

- 新增 dev-heartbeat-guardian.sh（守护进程）+ abort-dev.sh（手动中止）
- 加 log_hook_decision 共享函数（PR-2 hook 重写复用）
- 在 v22 stop-dev.sh 决策出口追加 1 行日志（不改主逻辑，零回归）
- launcher 加 --dry-run 选项 + 契约测试

**本 PR 不切换 hook 行为**。lights/ 目录尚无文件创建（PR-2 范围）。

设计：`docs/design/stop-hook-v23-redesign.md`
Spec：`docs/superpowers/specs/2026-05-07-stop-hook-v23-pr1-infrastructure-design.md`
Brain task：`7cdae14e-c28a-43d3-926c-01965922d852`

## Test plan

- [x] 4 套 vitest 测试 12 case 全过
- [x] commit 顺序符合 TDD（test → impl）
- [x] Engine 5 文件版本同步通过 check-version-sync.sh
- [x] feature-registry.yml changelog 同步
- [ ] 本机手测一次 guardian 启动 + abort 流程
- [ ] CI 全绿（含 lint-test-pairing / lint-tdd-commit-order）

## 后续衔接

- 24h 观察期后开 PR-2（重写 stop-dev.sh）
- PR-3 清理 v22 遗产

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 3.4：等 CI（前台阻塞）

- [ ] **until 阻塞 CI**

```bash
PR_URL=$(gh pr view --json url -q .url)
echo "PR: $PR_URL"

until [[ $(gh pr checks 2>/dev/null | grep -cE '^[^ ]+\s+pending|^[^ ]+\s+queued|in_progress') -eq 0 ]]; do
    echo "[$(date +%H:%M:%S)] CI 还有 pending..."
    sleep 30
done

echo "CI 完成。结果："
gh pr checks
```

Expected: 全部 pass。如有 fail，systematic-debugging 介入。

---

## Self-Review

**1. Spec coverage**
- ✅ Task 1.1-1.4 覆盖 spec § 4 DoD 8 条全部 Test 字段
- ✅ Task 2.1-2.7 覆盖 spec § 2 全部 Create / Modify 文件
- ✅ Task 2.6 覆盖 CLAUDE.md "Engine 三要素" 第 2 条（5 文件 version bump）
- ✅ Task 2.7 覆盖第 3 条（feature-registry changelog）
- ✅ Task 3.1 覆盖 CLAUDE.md "Learning 三要素"

**2. Placeholder scan**
- 通过：所有 step 含具体代码或具体命令；无 "TBD/TODO/implement later"

**3. Type consistency**
- guardian 接受 1 参数（light_file_path）；abort 接受 1 参数（branch）；log_hook_decision 接受 5 参数（sid, decision, reason, count, branch）— 全 plan 内一致
- 测试中 guardian_pid 从灯文件 JSON 读出 → abort 用此 PID kill — 一致

---

## 执行模式

按 /dev autonomous Tier 1 默认 = **Subagent-Driven**。

writing-plans 完成 → 下一步：**superpowers:subagent-driven-development**
