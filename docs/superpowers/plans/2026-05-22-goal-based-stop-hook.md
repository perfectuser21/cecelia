# Goal-Based Stop Hook 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Claude Code `/goal` prompt-based stop hook 替换 Cecelia 的 stop-dev.sh/guardian/devloop-check/ship-finalize 体系，Brain executor 通过 `--settings` 注入 goal_condition，Haiku 自动评估目标后放行 session 退出。

**Architecture:** executor.js 从 `task.goal_condition`（或 task_type 默认条件）生成 `--settings` JSON，经 cecelia-bridge.js 特殊处理（绕过 quote-strip）后注入 `CECELIA_GOAL_SETTINGS` 环境变量，cecelia-run.sh 写入临时文件并以 `--settings <tmpfile>` 传给 claude 进程。旧的 stop-dev.sh/guardian/devloop-check.sh/ship-finalize.sh 及其约 30 个测试全部删除。

**Tech Stack:** Node.js (executor.js CJS, cecelia-bridge.js), Bash (cecelia-run.sh, stop.sh), PostgreSQL migration, Vitest

---

## File Structure

**新建**:
- `packages/brain/src/migrations/281_add_goal_condition.sql`
- `packages/brain/src/__tests__/goal-settings-serializer.test.js`
- `packages/brain/scripts/smoke/goal-condition-smoke.sh`
- `packages/engine/tests/integration/goal-injection-chain.test.ts`
- `packages/engine/tests/hooks/stop-sh-routing.test.ts`

**修改**:
- `packages/brain/src/executor.js` — `buildGoalSettings()` + `HARNESS_GOAL_CONDITIONS` map + CECELIA_GOAL_SETTINGS 注入（1481 行前 + 3221 行后）
- `packages/brain/scripts/cecelia-bridge.js` — CECELIA_GOAL_SETTINGS 特殊处理（40-46 行）
- `packages/brain/scripts/cecelia-run.sh` — `SETTINGS_FLAG` 构建（509 行后）+ setsid 命令注入（623/630 行）
- `packages/engine/hooks/stop.sh` — 删除 stop-dev.sh 路由段（45-58 行）

**删除**:
- `packages/engine/hooks/stop-dev.sh`
- `packages/engine/lib/dev-heartbeat-guardian.sh`
- `packages/engine/lib/devloop-check.sh`
- `packages/engine/scripts/ship-finalize.sh`
- 约 30 个依赖上述文件的测试文件（Task 7 完整列表）

---

### Task 1: 写失败的 smoke.sh 骨架 + goal-injection-chain 集成测试（TDD commit 1）

**Files:**
- Create: `packages/brain/scripts/smoke/goal-condition-smoke.sh`
- Create: `packages/engine/tests/integration/goal-injection-chain.test.ts`

- [ ] **Step 1: 写 smoke.sh 骨架**

```bash
#!/usr/bin/env bash
# packages/brain/scripts/smoke/goal-condition-smoke.sh
# 验证 goal_condition 字段存在 + executor buildGoalSettings 可用
set -euo pipefail

BRAIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../src" && pwd)"
echo "[smoke:goal-condition] starting..."

# 1. goal_condition 列存在（需要先跑 migration 281）
node -e "
const {Pool} = require('pg');
const pool = new Pool({database:'cecelia',host:'localhost',port:5432,user:'postgres'});
pool.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name='goal_condition'\")
  .then(r => {
    if (r.rows.length === 0) { console.error('[smoke] FAIL: goal_condition column missing'); process.exit(1); }
    console.log('[smoke] goal_condition column exists ✓');
    return pool.end();
  })
  .catch(e => { console.error('[smoke] FAIL:', e.message); process.exit(1); });
"

# 2. buildGoalSettings 导出 + 结构正确
node -e "
const {buildGoalSettings} = require('$BRAIN_SRC/executor.js');
if (buildGoalSettings(null) !== null) { console.error('[smoke] FAIL: null input should return null'); process.exit(1); }
const result = buildGoalSettings('PR has been merged');
if (!result) { console.error('[smoke] FAIL: buildGoalSettings returned null for non-empty condition'); process.exit(1); }
const parsed = JSON.parse(result);
const hook = parsed.hooks.Stop[0].hooks[0];
if (hook.type !== 'prompt') { console.error('[smoke] FAIL: expected type=prompt, got', hook.type); process.exit(1); }
if (hook.model !== 'claude-haiku-4-5-20251001') { console.error('[smoke] FAIL: wrong model:', hook.model); process.exit(1); }
if (!hook.prompt.includes('PR has been merged')) { console.error('[smoke] FAIL: prompt missing goal condition'); process.exit(1); }
console.log('[smoke] buildGoalSettings structure correct ✓');
"

echo "[smoke:goal-condition] PASS ✓"
```

- [ ] **Step 2: 写失败的集成测试**

```typescript
// packages/engine/tests/integration/goal-injection-chain.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BRAIN_ROOT = resolve(__dirname, '../../../../brain');
const ENGINE_ROOT = resolve(__dirname, '../../..');

describe('goal injection chain', () => {
  it('executor.js exports buildGoalSettings returning correct Stop hook JSON', () => {
    const result = execSync(
      `node -e "const {buildGoalSettings} = require('${BRAIN_ROOT}/src/executor.js'); process.stdout.write(buildGoalSettings('the PR has been merged') || 'null')"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const parsed = JSON.parse(result);
    expect(parsed.hooks.Stop[0].hooks[0].type).toBe('prompt');
    expect(parsed.hooks.Stop[0].hooks[0].model).toBe('claude-haiku-4-5-20251001');
    expect(parsed.hooks.Stop[0].hooks[0].prompt).toContain('the PR has been merged');
  });

  it('buildGoalSettings returns null for null/empty condition', () => {
    const result = execSync(
      `node -e "const {buildGoalSettings} = require('${BRAIN_ROOT}/src/executor.js'); console.log(buildGoalSettings(null))"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    expect(result).toBe('null');
  });

  it('cecelia-bridge.js special-cases CECELIA_GOAL_SETTINGS (no SKILLENV_ prefix, JSON preserved)', () => {
    const source = readFileSync(resolve(BRAIN_ROOT, 'scripts/cecelia-bridge.js'), 'utf8');
    expect(source).toContain('CECELIA_GOAL_SETTINGS');
    // Must NOT generate SKILLENV_CECELIA_GOAL_SETTINGS
    expect(source).not.toMatch(/CECELIA_SKILLENV_CECELIA_GOAL_SETTINGS/);
    // Must use single-quote wrapping (preserves double quotes in JSON)
    expect(source).toMatch(/CECELIA_GOAL_SETTINGS='|CECELIA_GOAL_SETTINGS='\$\{/);
  });

  it('cecelia-run.sh writes CECELIA_GOAL_SETTINGS to temp file and appends --settings flag', () => {
    const source = readFileSync(resolve(BRAIN_ROOT, 'scripts/cecelia-run.sh'), 'utf8');
    expect(source).toContain('CECELIA_GOAL_SETTINGS');
    expect(source).toContain('SETTINGS_FLAG');
    expect(source).toContain('--settings');
  });
});
```

- [ ] **Step 3: 运行测试确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/goal-based-stop-hook
npx vitest run packages/engine/tests/integration/goal-injection-chain.test.ts 2>&1 | tail -20
```

期望: FAIL（`buildGoalSettings` 尚未实现）

- [ ] **Step 4: Commit（TDD 失败测试）**

```bash
git add packages/brain/scripts/smoke/goal-condition-smoke.sh packages/engine/tests/integration/goal-injection-chain.test.ts
git commit -m "test(goal-stop-hook): add failing integration tests + smoke skeleton (TDD commit 1)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: DB 迁移 — tasks 表新增 goal_condition 字段

**Files:**
- Create: `packages/brain/src/migrations/281_add_goal_condition.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- packages/brain/src/migrations/281_add_goal_condition.sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_condition TEXT;
COMMENT ON COLUMN tasks.goal_condition IS 'Claude Code --settings prompt-based stop hook condition string';
```

- [ ] **Step 2: 验证文件内容**

```bash
node -e "require('fs').accessSync('packages/brain/src/migrations/281_add_goal_condition.sql')" && echo "file exists ✓"
node -e "const c=require('fs').readFileSync('packages/brain/src/migrations/281_add_goal_condition.sql','utf8');if(!c.includes('goal_condition'))throw new Error('missing column');console.log('content OK ✓')"
```

期望: `file exists ✓` + `content OK ✓`

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/migrations/281_add_goal_condition.sql
git commit -m "feat(brain): migration 281 — add goal_condition to tasks table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: executor.js — buildGoalSettings + CECELIA_GOAL_SETTINGS 注入

**Files:**
- Modify: `packages/brain/src/executor.js` (1481 行 `getExtraEnvForTaskType` 之前 + 3221 行附近)
- Create: `packages/brain/src/__tests__/goal-settings-serializer.test.js`

- [ ] **Step 1: 写单元测试（先 fail）**

```javascript
// packages/brain/src/__tests__/goal-settings-serializer.test.js
import { describe, it, expect } from 'vitest';
import { buildGoalSettings } from '../executor.js';

describe('buildGoalSettings', () => {
  it('returns null for null condition', () => {
    expect(buildGoalSettings(null)).toBeNull();
  });

  it('returns null for empty string condition', () => {
    expect(buildGoalSettings('')).toBeNull();
  });

  it('returns JSON string with correct Stop hook structure', () => {
    const result = buildGoalSettings('PR has been merged');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'prompt',
            prompt: expect.stringContaining('PR has been merged'),
            model: 'claude-haiku-4-5-20251001'
          }]
        }]
      }
    });
  });

  it('embeds goal condition verbatim in prompt field', () => {
    const condition = 'All tests pass and PR is merged to main';
    const result = buildGoalSettings(condition);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.Stop[0].hooks[0].prompt).toContain(condition);
  });
});
```

- [ ] **Step 2: 运行确认 FAIL**

```bash
npx vitest run packages/brain/src/__tests__/goal-settings-serializer.test.js 2>&1 | tail -15
```

期望: FAIL（`buildGoalSettings` 未导出）

- [ ] **Step 3: 在 executor.js 中插入 HARNESS_GOAL_CONDITIONS + buildGoalSettings（在 `function getExtraEnvForTaskType` 之前，约 1481 行）**

读取 executor.js 确认 `function getExtraEnvForTaskType` 在第 1481 行，然后在该函数定义前插入：

```javascript
// 各 harness 阶段的预定义 goal conditions（task.goal_condition 为空时作为 fallback）
const HARNESS_GOAL_CONDITIONS = {
  'harness_spec':  'The spec document has been written and committed to docs/superpowers/specs/',
  'harness_code':  'All implementation is complete, all tests pass, and changes are committed to git',
  'harness_prci':  'A pull request has been created and pushed to GitHub, PR URL is shown in the conversation',
  'harness_ship':  'The pull request has been merged and all CI checks have passed',
  'spec':          'The spec document has been written and committed to docs/superpowers/specs/',
  'code':          'All implementation is complete, all tests pass, and changes are committed to git',
  'prci':          'A pull request has been created and pushed to GitHub, PR URL is shown in the conversation',
  'ship':          'The pull request has been merged and all CI checks have passed',
  'generic':       'The task described in the prompt has been completed successfully',
};

/**
 * 生成 Claude Code --settings prompt-based stop hook JSON。
 * @param {string|null} goalCondition
 * @returns {string|null} JSON 字符串；goalCondition 为空时返回 null
 */
function buildGoalSettings(goalCondition) {
  if (!goalCondition) return null;
  return JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{
          type: 'prompt',
          prompt: `Has the following goal been achieved based on the conversation? Goal: ${goalCondition}\n\nAnswer YES only if you can confirm from the conversation that the goal is met. Answer NO otherwise.`,
          model: 'claude-haiku-4-5-20251001'
        }]
      }]
    }
  });
}
```

- [ ] **Step 4: 将 buildGoalSettings 加入 module.exports**

在 executor.js 末尾的 `module.exports` 中，在 `getExtraEnvForTaskType` 一行之前添加：

```javascript
  buildGoalSettings,
```

- [ ] **Step 5: 在 extraEnv 构建后注入 goal settings（约 3221 行，credentials 注入后）**

在以下代码之后：
```javascript
    if (credentials) {
      extraEnv.CECELIA_CREDENTIALS = credentials;
    }
```

插入：
```javascript
    // goal-based stop hook: inject --settings JSON for tasks with goal_condition
    const _goalCond = task.goal_condition || HARNESS_GOAL_CONDITIONS[taskType] || null;
    const _goalSettings = buildGoalSettings(_goalCond);
    if (_goalSettings) {
      extraEnv.CECELIA_GOAL_SETTINGS = _goalSettings;
    }
```

- [ ] **Step 6: 运行单元测试确认 PASS**

```bash
npx vitest run packages/brain/src/__tests__/goal-settings-serializer.test.js 2>&1 | tail -15
```

期望: 4/4 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/executor.js packages/brain/src/__tests__/goal-settings-serializer.test.js
git commit -m "feat(brain): executor.js buildGoalSettings + CECELIA_GOAL_SETTINGS injection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: cecelia-bridge.js — CECELIA_GOAL_SETTINGS 绕过 quote-stripping

**Files:**
- Modify: `packages/brain/scripts/cecelia-bridge.js` (40-46 行)

- [ ] **Step 1: 替换 extra_env 处理逻辑**

当前代码（约 40-46 行）：
```javascript
        if (extra_env && typeof extra_env === 'object') {
          for (const [k, v] of Object.entries(extra_env)) {
            const safeKey = String(k).replace(/[^a-zA-Z0-9_]/g, '_');
            const safeVal = String(v).replace(/['"]/g, '');
            envVars += ` CECELIA_SKILLENV_${safeKey}="${safeVal}"`;
          }
        }
```

替换为（CECELIA_GOAL_SETTINGS 特殊处理：单引号包裹，不加 SKILLENV_ 前缀，不 strip 引号）：
```javascript
        if (extra_env && typeof extra_env === 'object') {
          // Special case: CECELIA_GOAL_SETTINGS is a JSON string containing double quotes.
          // Bypass quote-stripping and SKILLENV_ prefix — use single-quote wrapping.
          if (extra_env.CECELIA_GOAL_SETTINGS) {
            const jsonStr = String(extra_env.CECELIA_GOAL_SETTINGS);
            const escaped = jsonStr.replace(/'/g, "'\\''");
            envVars += ` CECELIA_GOAL_SETTINGS='${escaped}'`;
          }
          for (const [k, v] of Object.entries(extra_env)) {
            if (k === 'CECELIA_GOAL_SETTINGS') continue;
            const safeKey = String(k).replace(/[^a-zA-Z0-9_]/g, '_');
            const safeVal = String(v).replace(/['"]/g, '');
            envVars += ` CECELIA_SKILLENV_${safeKey}="${safeVal}"`;
          }
        }
```

- [ ] **Step 2: 验证改动后 bridge test 通过**

```bash
npx vitest run packages/engine/tests/integration/goal-injection-chain.test.ts 2>&1 | tail -20
```

期望: bridge 相关 test（test 3）PASS

- [ ] **Step 3: Commit**

```bash
git add packages/brain/scripts/cecelia-bridge.js
git commit -m "feat(brain): cecelia-bridge special-case CECELIA_GOAL_SETTINGS (bypass quote-strip)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: cecelia-run.sh — 注入 --settings 标志

**Files:**
- Modify: `packages/brain/scripts/cecelia-run.sh` (509 行后 + 623 行 + 630 行)

- [ ] **Step 1: 在 PROVIDER_ENV 构建 loop 之后（509 行 `done` 之后）插入 SETTINGS_FLAG 构建逻辑**

在以下行之后（第 509 行，`done` 结束 skillenv 循环）：
```bash
  done
```

插入：
```bash
  # goal-based stop hook: write CECELIA_GOAL_SETTINGS to temp file, pass as --settings flag
  local SETTINGS_FLAG=""
  if [[ -n "${CECELIA_GOAL_SETTINGS:-}" ]]; then
    local _goal_settings_tmp
    _goal_settings_tmp=$(mktemp /tmp/cecelia-goal-settings-XXXXXX.json)
    printf '%s' "$CECELIA_GOAL_SETTINGS" > "$_goal_settings_tmp"
    SETTINGS_FLAG="--settings $_goal_settings_tmp"
    echo "[cecelia-run] goal-based stop hook enabled (settings: $_goal_settings_tmp)" >&2
  fi
```

- [ ] **Step 2: 将 `$SETTINGS_FLAG` 加入 plan 模式 setsid 命令（约 623 行）**

当前（约 623 行）：
```bash
      setsid bash -c "cd '$ACTUAL_WORK_DIR' && unset CLAUDECODE && CECELIA_HEADLESS=true $PROVIDER_ENV $CLAUDE_INVOKE --permission-mode plan $MODEL_FLAG $MAX_TURNS_FLAG --output-format json >\"$out_json\" 2>\"$err_log\"" _ "$original_prompt" </dev/null &
```

改为（在 `$MAX_TURNS_FLAG` 后加 `$SETTINGS_FLAG`）：
```bash
      setsid bash -c "cd '$ACTUAL_WORK_DIR' && unset CLAUDECODE && CECELIA_HEADLESS=true $PROVIDER_ENV $CLAUDE_INVOKE --permission-mode plan $MODEL_FLAG $MAX_TURNS_FLAG $SETTINGS_FLAG --output-format json >\"$out_json\" 2>\"$err_log\"" _ "$original_prompt" </dev/null &
```

- [ ] **Step 3: 将 `$SETTINGS_FLAG` 加入 bypassPermissions 模式 setsid 命令（约 630 行）**

当前（约 630 行）：
```bash
      setsid bash -c "cd '$ACTUAL_WORK_DIR' && unset CLAUDECODE && CECELIA_HEADLESS=true $PROVIDER_ENV $CLAUDE_INVOKE --dangerously-skip-permissions $MODEL_FLAG $MAX_TURNS_FLAG --output-format json >\"$out_json\" 2>\"$err_log\"" _ "$original_prompt" </dev/null &
```

改为：
```bash
      setsid bash -c "cd '$ACTUAL_WORK_DIR' && unset CLAUDECODE && CECELIA_HEADLESS=true $PROVIDER_ENV $CLAUDE_INVOKE --dangerously-skip-permissions $MODEL_FLAG $MAX_TURNS_FLAG $SETTINGS_FLAG --output-format json >\"$out_json\" 2>\"$err_log\"" _ "$original_prompt" </dev/null &
```

- [ ] **Step 4: 运行完整集成测试确认 4/4 PASS**

```bash
npx vitest run packages/engine/tests/integration/goal-injection-chain.test.ts 2>&1 | tail -20
```

期望: 4/4 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/cecelia-run.sh
git commit -m "feat(brain): cecelia-run.sh inject --settings flag from CECELIA_GOAL_SETTINGS

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: stop.sh — 删除 stop-dev.sh 路由段

**Files:**
- Modify: `packages/engine/hooks/stop.sh` (45-58 行)

- [ ] **Step 1: 删除 stop-dev.sh 调用段（约 45-58 行）**

找到并删除以下完整段落（从注释到 `esac`）：
```bash
# ===== v19.0.0: 无条件调用 stop-dev.sh（cwd-as-key，由 stop-dev.sh 自判）=====
# stop-dev.sh 用 CLAUDE_HOOK_CWD（已由上方解析）确定 worktree + branch
# v20.1.0 三态退出码：
#   0  → done（继续走 architect/decomp/cleanup chain，最终 exit 0）
#   99 → not-applicable（pass-through，继续走 architect/decomp chain）
#   2  → blocked（直接传给 Claude Code，让 assistant 继续干活）
#   其他 → 异常，原样传出
# 关键：set -e 会在任何非 0 退出时立即 abort，所以必须用 || 兜住才能拿到 $?
_stop_dev_exit=0
bash "$SCRIPT_DIR/stop-dev.sh" || _stop_dev_exit=$?
case "$_stop_dev_exit" in
    0|99) ;;  # done 或 not-applicable → fall-through 到下方 architect/decomp 路由
    *)    exit "$_stop_dev_exit" ;;
esac
```

同时更新顶部注释（第 6 行）删除 stop-dev.sh 那一行：
删除：`# - .dev-mode.<branch>  → stop-dev.sh    (/dev 工作流，cwd-as-key)`

- [ ] **Step 2: 验证 stop-dev.sh 引用已删除**

```bash
! grep -q 'stop-dev.sh' packages/engine/hooks/stop.sh && echo "stop-dev.sh 引用已删除 ✓"
```

期望: `stop-dev.sh 引用已删除 ✓`

- [ ] **Step 3: 验证 architect/decomp 路由仍在**

```bash
grep -c 'stop-architect.sh\|stop-decomp.sh' packages/engine/hooks/stop.sh
```

期望: `2`

- [ ] **Step 4: Commit**

```bash
git add packages/engine/hooks/stop.sh
git commit -m "feat(engine): stop.sh remove stop-dev.sh routing (replaced by goal-based hook)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: 删除旧 stop hook 文件 + 依赖测试

**Files:**
- Delete: `packages/engine/hooks/stop-dev.sh`
- Delete: `packages/engine/lib/dev-heartbeat-guardian.sh`
- Delete: `packages/engine/lib/devloop-check.sh`
- Delete: `packages/engine/scripts/ship-finalize.sh`
- Delete: 约 30 个测试文件（见 Step 3）

- [ ] **Step 1: 删除 4 个核心 stop hook 文件**

```bash
rm packages/engine/hooks/stop-dev.sh
rm packages/engine/lib/dev-heartbeat-guardian.sh
rm packages/engine/lib/devloop-check.sh
rm packages/engine/scripts/ship-finalize.sh
```

- [ ] **Step 2: 确认 4 个文件已删除**

```bash
node -e "
const fs = require('fs');
const files = [
  'packages/engine/hooks/stop-dev.sh',
  'packages/engine/lib/dev-heartbeat-guardian.sh',
  'packages/engine/lib/devloop-check.sh',
  'packages/engine/scripts/ship-finalize.sh',
];
for (const f of files) {
  try { fs.accessSync(f); console.error('FAIL: still exists:', f); process.exit(1); }
  catch {}
}
console.log('All 4 core files deleted ✓');
"
```

- [ ] **Step 3: 删除所有直接测试已删文件的测试**

```bash
rm -f \
  packages/engine/tests/hooks/heartbeat-guardian.test.ts \
  packages/engine/tests/hooks/stop-hook-v23-routing.test.ts \
  packages/engine/tests/hooks/stop-hook-v23-decision.test.ts \
  packages/engine/tests/hooks/abort-dev.test.ts \
  packages/engine/tests/hooks/hook-gates.test.ts \
  packages/engine/tests/hooks/stop-hook-exit-codes.test.ts \
  packages/engine/tests/hooks/stop-hook-single-exit.test.ts \
  packages/engine/tests/hooks/hook-decision-log.test.ts \
  packages/engine/tests/hooks/stop-hook-v24.test.ts \
  packages/engine/tests/hooks/stop-hook-session-isolation.test.ts \
  packages/engine/tests/hooks/stop-hook-exit.test.ts \
  packages/engine/tests/hooks/stop-hook.test.ts \
  packages/engine/tests/hooks/stop-hook-bypass-3layer.test.ts \
  packages/engine/tests/ship-finalize-guardian-alive.test.ts \
  packages/engine/tests/stop-hook-branch-fallback.test.ts \
  packages/engine/tests/stop-hook-basic.test.sh \
  packages/engine/tests/stop-hook-router.test.sh \
  packages/engine/tests/integration/stop-dev-deploy-escape.test.sh \
  packages/engine/tests/integration/stop-dev-exit-code.test.sh \
  packages/engine/tests/integration/devloop-classify.test.sh \
  packages/engine/tests/devgate/devloop-check-no-playwright.test.ts \
  packages/engine/tests/scripts/devloop-check-gates.test.ts \
  packages/engine/tests/scripts/devloop-ci-counter.test.ts \
  packages/engine/tests/scripts/devloop-check-evaluator.test.ts \
  packages/engine/tests/scripts/devloop-check-harness-single-exit.test.ts \
  packages/engine/tests/scripts/devloop-check-pr-timing.test.ts \
  packages/engine/tests/engine/devloop-check-entry.test.ts \
  packages/engine/tests/stop-hook/test-full-hardlock.sh \
  packages/engine/tests/stop-hook/test-headless-hardlock.sh \
  packages/engine/tests/stop-hook/test-lock-fail-hardlock.sh \
  packages/engine/tests/integrity/stop-hook-coverage.test.sh
```

- [ ] **Step 4: 扫描残留引用，逐文件清理**

```bash
grep -rn "stop-dev\|devloop-check\|dev-heartbeat-guardian\|ship-finalize" \
  packages/engine/tests/ --include="*.ts" --include="*.sh" -l 2>/dev/null \
  || echo "No remaining references ✓"
```

对每个残留文件，逐一判断：
- **整个文件都在测试被删功能** → `rm` 整个文件
- **只有部分 `it()`/`describe()` 块引用被删文件** → 删除相关代码块，保留其余测试

- [ ] **Step 5: 运行 engine 测试确认无 import/require 错误**

```bash
npx vitest run packages/engine/tests/ --passWithNoTests 2>&1 | grep -E "FAIL|Error|Cannot find" | head -20 || echo "No errors ✓"
```

期望: 无 "Cannot find module" 或 "FAIL" 错误

- [ ] **Step 6: Commit**

```bash
git add -u
git add packages/engine/tests/
git commit -m "feat(engine): delete stop-dev.sh/guardian/devloop-check/ship-finalize + their tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: stop.sh 回归测试 + 全链路验证

**Files:**
- Create: `packages/engine/tests/hooks/stop-sh-routing.test.ts`

- [ ] **Step 1: 写 stop.sh architect/decomp 回归测试**

```typescript
// packages/engine/tests/hooks/stop-sh-routing.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const ENGINE_ROOT = resolve(__dirname, '../../..');
const STOP_SH = resolve(ENGINE_ROOT, 'hooks/stop.sh');
const STOP_DEV_SH = resolve(ENGINE_ROOT, 'hooks/stop-dev.sh');
const DEVLOOP_CHECK = resolve(ENGINE_ROOT, 'lib/devloop-check.sh');
const GUARDIAN = resolve(ENGINE_ROOT, 'lib/dev-heartbeat-guardian.sh');
const SHIP_FINALIZE = resolve(ENGINE_ROOT, 'scripts/ship-finalize.sh');

describe('stop.sh routing — post goal-hook refactor', () => {
  it('stop-dev.sh has been deleted', () => {
    expect(existsSync(STOP_DEV_SH)).toBe(false);
  });

  it('dev-heartbeat-guardian.sh has been deleted', () => {
    expect(existsSync(GUARDIAN)).toBe(false);
  });

  it('devloop-check.sh has been deleted', () => {
    expect(existsSync(DEVLOOP_CHECK)).toBe(false);
  });

  it('ship-finalize.sh has been deleted', () => {
    expect(existsSync(SHIP_FINALIZE)).toBe(false);
  });

  it('stop.sh does NOT reference stop-dev.sh', () => {
    const source = readFileSync(STOP_SH, 'utf8');
    expect(source).not.toContain('stop-dev.sh');
  });

  it('stop.sh still routes to stop-architect.sh and stop-decomp.sh', () => {
    const source = readFileSync(STOP_SH, 'utf8');
    expect(source).toContain('stop-architect.sh');
    expect(source).toContain('stop-decomp.sh');
  });

  it('stop.sh exits 0 in plain session (no lock files)', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'stop-sh-plain-'));
    try {
      execSync('git init -q && git commit --allow-empty -m "init"', { cwd: testDir, stdio: 'pipe' });
      const result = spawnSync('bash', [STOP_SH], {
        cwd: testDir,
        env: {
          ...process.env,
          CLAUDE_HOOK_STDIN_JSON_OVERRIDE: JSON.stringify({
            session_id: 'test-plain-session',
            cwd: testDir,
            transcript_path: ''
          }),
          HOME: testDir,
        },
        timeout: 5000
      });
      expect(result.status).toBe(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行回归测试**

```bash
npx vitest run packages/engine/tests/hooks/stop-sh-routing.test.ts 2>&1 | tail -20
```

期望: 7/7 PASS

- [ ] **Step 3: 运行全量测试（Brain 单元 + Engine 集成）**

```bash
npx vitest run \
  packages/brain/src/__tests__/goal-settings-serializer.test.js \
  packages/engine/tests/integration/goal-injection-chain.test.ts \
  packages/engine/tests/hooks/stop-sh-routing.test.ts \
  2>&1 | tail -30
```

期望: 全部 PASS（合计约 15 个 tests）

- [ ] **Step 4: 验证全部 DoD 成功标准**

```bash
# [ARTIFACT] 281 迁移文件存在
node -e "require('fs').accessSync('packages/brain/src/migrations/281_add_goal_condition.sql')" && echo "✓ 281_add_goal_condition.sql"

# [ARTIFACT] stop-dev.sh 不存在
node -e "const fs=require('fs');try{fs.accessSync('packages/engine/hooks/stop-dev.sh');process.exit(1)}catch{console.log('✓ stop-dev.sh deleted')}"

# [ARTIFACT] devloop-check.sh 不存在
node -e "const fs=require('fs');try{fs.accessSync('packages/engine/lib/devloop-check.sh');process.exit(1)}catch{console.log('✓ devloop-check.sh deleted')}"

# [BEHAVIOR] buildGoalSettings 结构正确
node -e "
const {buildGoalSettings}=require('packages/brain/src/executor.js');
const r=JSON.parse(buildGoalSettings('test condition'));
if(r.hooks.Stop[0].hooks[0].type!=='prompt')process.exit(1);
console.log('✓ buildGoalSettings correct');
"

# [BEHAVIOR] cecelia-run.sh 含 --settings + SETTINGS_FLAG
node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('--settings')||!c.includes('SETTINGS_FLAG')||!c.includes('CECELIA_GOAL_SETTINGS'))process.exit(1);console.log('✓ cecelia-run.sh has --settings')"

# [BEHAVIOR] stop.sh 无 stop-dev.sh 引用
! grep -q 'stop-dev.sh' packages/engine/hooks/stop.sh && echo "✓ stop.sh clean"
```

期望: 所有 `✓` 输出，无 process.exit(1)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/tests/hooks/stop-sh-routing.test.ts
git commit -m "test(engine): add stop.sh routing regression tests + verify all DoD

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 自我检查

**Spec coverage**:
- ✅ DB migration 281_add_goal_condition.sql — Task 2
- ✅ buildGoalSettings + HARNESS_GOAL_CONDITIONS — Task 3
- ✅ CECELIA_GOAL_SETTINGS 注入 extra_env — Task 3
- ✅ cecelia-bridge.js 绕过 quote-strip — Task 4
- ✅ cecelia-run.sh --settings 注入 — Task 5
- ✅ stop.sh 删除 stop-dev.sh 路由 — Task 6
- ✅ 删除 stop-dev.sh/guardian/devloop-check.sh/ship-finalize.sh — Task 7
- ✅ 删除相关测试 — Task 7
- ✅ stop.sh architect/decomp 回归测试 — Task 8

**Placeholder scan**: 无 TBD / TODO / 模糊步骤

**Type consistency**: `buildGoalSettings(string|null) → string|null`，贯通 Task 1/3/8
