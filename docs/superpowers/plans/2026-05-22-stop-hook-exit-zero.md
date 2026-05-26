# Stop Hook Exit-Zero 三处根因修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 stop hook 在 engine-ship 后和无头模式下错误 exit 0 的三处根因，确保 PR 合并前 guardian 守护 CI 全程。

**Architecture:** 三处独立改动：(1) 移除 ship-finalize.sh 的 SIGTERM，让 stop hook 自己清理 guardian；(2) 删除 executor.js 中错位的 CLAUDE_SESSION_ID 注入；(3) stop-dev.sh 加 branch 名兜底扫描覆盖 session ID 错位场景。

**Tech Stack:** Bash (ship-finalize.sh, stop-dev.sh), TypeScript/Vitest (测试), Node.js (executor.js)

---

## 文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| Modify | `packages/engine/scripts/ship-finalize.sh` | 删除第 55-61 行 SIGTERM 块，更新注释 |
| Modify | `packages/brain/src/executor.js` | 删除第 3175-3177 行 CLAUDE_SESSION_ID 注入 |
| Modify | `packages/engine/hooks/stop-dev.sh` | 第 189 行前插入 branch 兜底扫描 |
| Create | `packages/engine/tests/ship-finalize-guardian-alive.test.ts` | Fix 1 行为测试 |
| Create | `packages/engine/tests/stop-hook-branch-fallback.test.ts` | Fix 3 行为测试 |

---

## Task 1：写 Fix 1 的失败测试（ship-finalize 后 guardian 仍存活）

**Files:**
- Create: `packages/engine/tests/ship-finalize-guardian-alive.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// packages/engine/tests/ship-finalize-guardian-alive.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const SHIP_FINALIZE = require('path').resolve(__dirname, '../../scripts/ship-finalize.sh')
const GUARDIAN_LIB = require('path').resolve(__dirname, '../../lib/dev-heartbeat-guardian.sh')

describe('ship-finalize.sh — Fix 1：guardian 在 ship-finalize 后仍存活', () => {
  let mainRepo: string

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'sfgrd-'))
    execSync(
      `cd ${mainRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q && git branch -M main`,
      { stdio: 'pipe' }
    )
  })

  afterEach(() => {
    try { execSync(`pkill -f 'dev-heartbeat-guardian.sh.*${mainRepo}' || true`) } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('ship-finalize.sh 执行后 guardian 进程仍然存活', async () => {
    const branch = 'cp-test-ship-finalize'
    const lightsDir = join(mainRepo, '.cecelia/lights')
    mkdirSync(lightsDir, { recursive: true })

    // 启动一个 mock guardian（简单 sleep 进程）
    const { pid: guardianPid } = spawnSync('bash', ['-c', 'sleep 60 & echo $!'], {
      encoding: 'utf8',
    })
    const gpid = parseInt(guardianPid.trim())

    // 写 light 文件
    const lightFile = join(lightsDir, `abc12345-${branch}.live`)
    writeFileSync(lightFile, JSON.stringify({
      branch,
      guardian_pid: gpid,
      session_id: 'abc12345-test',
      session_id_short: 'abc12345',
    }))

    // 写 done-markers 目录
    mkdirSync(join(mainRepo, '.cecelia/done-markers'), { recursive: true })

    // 执行 ship-finalize.sh
    const result = execSync(
      `cd ${mainRepo} && bash ${SHIP_FINALIZE} ${branch} 123 https://github.com/x/y/pull/123 2>&1`,
      { encoding: 'utf8' }
    )

    // 验证 guardian 仍然存活
    const alive = spawnSync('kill', ['-0', String(gpid)])
    expect(alive.status).toBe(0) // kill -0 成功 = 进程存活

    // 验证 done-marker 已写（ship-finalize 的 done-marker 功能应保留）
    const markers = require('fs').readdirSync(join(mainRepo, '.cecelia/done-markers'))
    expect(markers.length).toBeGreaterThan(0)

    // 验证输出中不含 SIGTERM
    expect(result).not.toContain('SIGTERM')

    // 清理 mock guardian
    try { process.kill(gpid) } catch {}
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
npx vitest run packages/engine/tests/ship-finalize-guardian-alive.test.ts 2>&1 | tail -20
```

期望：FAIL — `expect(result).not.toContain('SIGTERM')` 失败（现在的 ship-finalize 会发 SIGTERM）

- [ ] **Step 3：commit 失败测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
git add packages/engine/tests/ship-finalize-guardian-alive.test.ts
git commit -m "test(engine): [FAIL] ship-finalize 后 guardian 应存活

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2：写 Fix 3 的失败测试（stop-dev.sh branch 名兜底）

**Files:**
- Create: `packages/engine/tests/stop-hook-branch-fallback.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// packages/engine/tests/stop-hook-branch-fallback.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const STOP_DEV = require('path').resolve(__dirname, '../../hooks/stop-dev.sh')

describe('stop-dev.sh — Fix 3：branch 名兜底扫描', () => {
  let mainRepo: string
  let branchRepo: string

  beforeEach(() => {
    // mainRepo: 存放 lights 目录
    mainRepo = mkdtempSync(join(tmpdir(), 'stophook-'))
    execSync(
      `cd ${mainRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q && git branch -M main`,
      { stdio: 'pipe' }
    )

    // branchRepo: 模拟在 cp-xxx 分支的 worktree（stop hook 运行的 cwd）
    branchRepo = mkdtempSync(join(tmpdir(), 'branchrepo-'))
    execSync(
      `cd ${branchRepo} && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q && git checkout -b cp-fix-test-branch -q`,
      { stdio: 'pipe' }
    )

    // 在 branchRepo 的 git config 里设置 worktree 指向 mainRepo（模拟 worktree list 结果）
    execSync(`git -C ${branchRepo} config core.worktree ${branchRepo}`)
  })

  afterEach(() => {
    rmSync(mainRepo, { recursive: true, force: true })
    rmSync(branchRepo, { recursive: true, force: true })
  })

  it('session ID 错位时，按 branch 名找到 light，仍能 block', () => {
    const branch = 'cp-fix-test-branch'
    const lightsDir = join(mainRepo, '.cecelia/lights')
    mkdirSync(lightsDir, { recursive: true })

    // 故意用错误的 session ID 前缀命名 light（模拟 executor 注入 Brain task ID 的情况）
    const wrongPrefix = 'wrongsid'
    const lightFile = join(lightsDir, `${wrongPrefix}-${branch}.live`)
    writeFileSync(lightFile, JSON.stringify({
      branch,
      guardian_pid: 99999,
      session_id: `${wrongPrefix}-mock`,
      session_id_short: wrongPrefix,
      stage: 'stage_1_spec',
    }))

    // mock classify_session：通过环境变量让 devloop-check.sh 返回 blocked
    // 用 DEVLOOP_CHECK_MOCK_STATUS 变量（需要在 devloop-check.sh 支持，这里用 override 方式）
    // 实际测试：直接 mock devloop-check.sh source 路径

    // 创建 mock devloop-check.sh
    const mockDevloopCheck = join(mainRepo, 'mock-devloop-check.sh')
    writeFileSync(mockDevloopCheck, `
classify_session() {
  echo '{"status":"blocked","reason":"Dev session in progress (mock)","action":"继续开发"}'
  return 2
}
log_hook_decision() { :; }
`)

    // 设置 hook session ID 为不匹配的 UUID（模拟 Claude Code 真实 session ID）
    const realSessionId = 'aabbccdd-1234-5678-90ab-cdef01234567'

    const result = execSync(
      `CLAUDE_HOOK_SESSION_ID="${realSessionId}" CLAUDE_HOOK_CWD="${branchRepo}" ` +
      `STOP_HOOK_LIGHT_TTL_SEC=300 ` +
      `bash ${STOP_DEV} 2>/dev/null; echo "exit_code=$?"`,
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_HOOK_SESSION_ID: realSessionId,
          CLAUDE_HOOK_CWD: branchRepo,
          STOP_HOOK_LIGHT_TTL_SEC: '300',
        }
      }
    ).trim()

    // Fix 3 实现前：exit_code=0（all_dark，branch 兜底不存在）
    // Fix 3 实现后：exit_code=2（block，branch 兜底找到 light）
    expect(result).toContain('exit_code=2')
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
npx vitest run packages/engine/tests/stop-hook-branch-fallback.test.ts 2>&1 | tail -20
```

期望：FAIL — `expect(result).toContain('exit_code=2')` 失败（现在 all_dark → exit 0）

- [ ] **Step 3：commit 失败测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
git add packages/engine/tests/stop-hook-branch-fallback.test.ts
git commit -m "test(engine): [FAIL] stop-dev.sh branch 兜底扫描

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3：实现 Fix 1 — ship-finalize.sh 移除 SIGTERM

**Files:**
- Modify: `packages/engine/scripts/ship-finalize.sh`

- [ ] **Step 1：删除 SIGTERM 块，更新注释**

编辑 `packages/engine/scripts/ship-finalize.sh`：

1. 将文件头第 2 行注释从：
   ```
   # ship-finalize.sh — engine-ship 调用：写 done-marker + SIGTERM guardian
   ```
   改为：
   ```
   # ship-finalize.sh — engine-ship 调用：写 done-marker（guardian 由 stop hook 自行清理）
   ```

2. 将第 5-8 行注释块从：
   ```
   #   1. 找 .cecelia/lights/<sid_short>-<branch>.live
   #   2. 读 guardian_pid，发 SIGTERM（guardian trap 自删 light）
   #   3. 写 .cecelia/done-markers/<sid_short>-<branch>.done
   ```
   改为：
   ```
   #   1. 找 .cecelia/lights/<sid_short>-<branch>.live
   #   2. 写 .cecelia/done-markers/<sid_short>-<branch>.done
   #   注：guardian 不再由此脚本杀死，改由 stop hook classify_session→done 后清理
   ```

3. 删除第 55-61 行整个 SIGTERM 块：
   ```bash
   if [[ -n "${PID:-}" && "$PID" =~ ^[0-9]+$ ]]; then
       if kill -SIGTERM "$PID" 2>/dev/null; then
           echo "[ship-finalize] SIGTERM sent to guardian pid=$PID" >&2
       else
           echo "[ship-finalize] guardian pid=$PID 已死或不存在" >&2
       fi
   fi
   ```

删除后，文件末尾应为：
```bash
echo "[ship-finalize] done-marker written: $MARKER" >&2

exit 0
```

- [ ] **Step 2：运行 Fix 1 测试，确认变绿**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
npx vitest run packages/engine/tests/ship-finalize-guardian-alive.test.ts 2>&1 | tail -10
```

期望：PASS

- [ ] **Step 3：commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
git add packages/engine/scripts/ship-finalize.sh
git commit -m "fix(engine): ship-finalize 不再 SIGTERM guardian，由 stop hook 自行清理

guardian 存活到 stop hook classify_session→done 才清理，确保 PR 合并前 CI 全程被守护。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4：实现 Fix 2 — executor.js 删除 CLAUDE_SESSION_ID 注入

**Files:**
- Modify: `packages/brain/src/executor.js:3175-3177`

- [ ] **Step 1：删除三行**

打开 `packages/brain/src/executor.js`，找到第 3173-3178 行区域：

```js
    const permissionMode = getPermissionModeForTaskType(taskType);
    const extraEnv = getExtraEnvForTaskType(taskType);
    // 无头模式下 tty 不可用，注入 CLAUDE_SESSION_ID 供 Stop Hook _session_matches() 会话隔离
    // worktree-manage.sh 写 .dev-lock 时读取此变量作为 session_id 字段
    extraEnv.CLAUDE_SESSION_ID = task.id;
    const model = getModelForTask(task);
```

删除第 3175-3177 行（注释 + 赋值），保留其余：

```js
    const permissionMode = getPermissionModeForTaskType(taskType);
    const extraEnv = getExtraEnvForTaskType(taskType);
    const model = getModelForTask(task);
```

- [ ] **Step 2：验证删除正确**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('CLAUDE_SESSION_ID = task.id'))process.exit(1);console.log('✅ CLAUDE_SESSION_ID 注入已删除')"
```

期望：`✅ CLAUDE_SESSION_ID 注入已删除`

- [ ] **Step 3：commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
git add packages/brain/src/executor.js
git commit -m "fix(brain): 移除 executor 对 CLAUDE_SESSION_ID=task.id 的注入

该代码是 v19 .dev-lock 时代的遗留，注释引用的 _session_matches() 已废弃。
现在的 lights 系统需要 worktree-manage.sh 用真实 Claude Code session ID
命名 light 文件，而非 Brain task UUID。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5：实现 Fix 3 — stop-dev.sh 加 branch 名兜底扫描

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh:189`

- [ ] **Step 1：在第 189 行前插入兜底逻辑**

找到 `packages/engine/hooks/stop-dev.sh` 第 188-192 行：

```bash
        if (( LIGHTS_COUNT > 0 )); then
            # 有亮灯 → 调 classify_session ...
            ...
        else
            REASON_CODE="all_dark"
        fi
```

在 `else` 行（`REASON_CODE="all_dark"`）之前，插入：

```bash
        # 兜底：session ID 错位时按 branch 名反扫（headless 无头模式 executor 注入错误 ID）
        if (( LIGHTS_COUNT == 0 )) && [[ -n "$hook_session_id" ]]; then
            _fb_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
            if [[ -n "$_fb_branch" && "$_fb_branch" != "main" && "$_fb_branch" != "HEAD" ]]; then
                for _fb_light in "$lights_dir"/*-"${_fb_branch}".live; do
                    [[ -f "$_fb_light" ]] || continue
                    if [[ "$(uname)" == "Darwin" ]]; then
                        _fb_mtime=$(stat -f %m "$_fb_light" 2>/dev/null || echo 0)
                    else
                        _fb_mtime=$(stat -c %Y "$_fb_light" 2>/dev/null || echo 0)
                    fi
                    _fb_age=$(( now - _fb_mtime ))
                    if (( _fb_age <= TTL_SEC )); then
                        LIGHTS_COUNT=$((LIGHTS_COUNT + 1))
                        FIRST_BRANCH="$_fb_branch"
                        break
                    fi
                done
            fi
        fi
```

插入后完整结构：

```bash
        for light in "$lights_dir/${SID_SHORT}-"*.live; do
            # ... 现有 session ID 主扫描逻辑 ...
        done

        # 兜底：session ID 错位时按 branch 名反扫（headless 无头模式 executor 注入错误 ID）
        if (( LIGHTS_COUNT == 0 )) && [[ -n "$hook_session_id" ]]; then
            _fb_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
            if [[ -n "$_fb_branch" && "$_fb_branch" != "main" && "$_fb_branch" != "HEAD" ]]; then
                for _fb_light in "$lights_dir"/*-"${_fb_branch}".live; do
                    [[ -f "$_fb_light" ]] || continue
                    if [[ "$(uname)" == "Darwin" ]]; then
                        _fb_mtime=$(stat -f %m "$_fb_light" 2>/dev/null || echo 0)
                    else
                        _fb_mtime=$(stat -c %Y "$_fb_light" 2>/dev/null || echo 0)
                    fi
                    _fb_age=$(( now - _fb_mtime ))
                    if (( _fb_age <= TTL_SEC )); then
                        LIGHTS_COUNT=$((LIGHTS_COUNT + 1))
                        FIRST_BRANCH="$_fb_branch"
                        break
                    fi
                done
            fi
        fi

        if (( LIGHTS_COUNT > 0 )); then
            # 有亮灯 → 调 classify_session ...
        else
            REASON_CODE="all_dark"
        fi
```

- [ ] **Step 2：运行 Fix 3 测试，确认变绿**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
npx vitest run packages/engine/tests/stop-hook-branch-fallback.test.ts 2>&1 | tail -10
```

期望：PASS

- [ ] **Step 3：运行所有 engine 测试，确认无退步**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
npx vitest run packages/engine/tests/ 2>&1 | tail -20
```

期望：所有原有测试仍 PASS

- [ ] **Step 4：commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
git add packages/engine/hooks/stop-dev.sh
git commit -m "fix(engine): stop-dev.sh 加 branch 名兜底扫描覆盖 session ID 错位场景

无头模式下 executor 注入错误 CLAUDE_SESSION_ID（Brain task UUID），导致
light 文件名前缀不匹配，stop hook 看到 all_dark 而 exit 0。
新增 branch 名反扫：session ID 扫描为 0 时，按当前 branch 名匹配 light，
兜底确保 headless 模式下 stop hook 仍能正确 block。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6：DoD 验证 + 写 Learning + 推 PR

**Files:**
- Modify: `docs/superpowers/specs/2026-05-22-stop-hook-exit-zero-design.md` (勾选 DoD)

- [ ] **Step 1：验证所有 DoD 条目**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero

# DoD 1: ship-finalize.sh 不含 kill -SIGTERM
node -e "const c=require('fs').readFileSync('packages/engine/scripts/ship-finalize.sh','utf8');if(c.includes('kill -SIGTERM'))process.exit(1);console.log('✅ DoD1 PASS')"

# DoD 2: executor.js 不含 CLAUDE_SESSION_ID = task.id
node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('CLAUDE_SESSION_ID = task.id'))process.exit(1);console.log('✅ DoD2 PASS')"

# DoD 3+4: 跑测试
npx vitest run packages/engine/tests/stop-hook-branch-fallback.test.ts packages/engine/tests/ship-finalize-guardian-alive.test.ts 2>&1 | tail -10
```

期望：4个 PASS

- [ ] **Step 2：将 spec 中 DoD 的 `[ ]` 全部改为 `[x]`**

编辑 `docs/superpowers/specs/2026-05-22-stop-hook-exit-zero-design.md`，将所有 `- [ ]` 改为 `- [x]`。

- [ ] **Step 3：写 Learning 文件**

```bash
cat > /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero/docs/learnings/cp-0522091527-fix-stop-hook-exit-zero.md << 'EOF'
## Stop Hook Exit-Zero 三处根因修复（2026-05-22）

### 根本原因

1. **ship-finalize.sh 过早杀 guardian**：engine-ship 在 PR 推送后调 ship-finalize，立即 SIGTERM guardian。Light 消失，stop hook 无法 block，PR 无人等 CI。

2. **executor.js 注入错误 CLAUDE_SESSION_ID**：`extraEnv.CLAUDE_SESSION_ID = task.id` 是 v19 .dev-lock 时代遗留代码，导致 worktree-manage.sh 用 Brain task UUID 命名 light，与 stop hook 实际扫描的 Claude session UUID 前缀不匹配。

3. **stop-dev.sh 无 branch 兜底**：仅靠 session ID 前缀扫描，错位时直接 all_dark → exit 0。

### 下次预防

- [ ] engine-ship 类脚本修改时，检查是否有提前清理 guardian 的逻辑
- [ ] executor.js 注入 env var 时，确认不覆盖 worktree-manage.sh 的 session ID 解析
- [ ] stop hook 新增 REASON_CODE 时，思考"lights 为空"的兜底场景
EOF
```

- [ ] **Step 4：提交 DoD + Learning**

```bash
cd /Users/administrator/worktrees/cecelia/fix-stop-hook-exit-zero
git add docs/superpowers/specs/2026-05-22-stop-hook-exit-zero-design.md \
        docs/learnings/cp-0522091527-fix-stop-hook-exit-zero.md
git commit -m "docs: DoD 验收完成 + Learning for stop-hook-exit-zero

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5：推送 + 创 PR（engine-ship 会接管后续）**

进入 engine-ship skill：调用 `Skill({"skill":"engine-ship"})`
