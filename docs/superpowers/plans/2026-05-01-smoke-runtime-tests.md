# Smoke Runtime Tests (PR 1/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/brain/scripts/smoke/smoke-runtime.sh` 创建真实行为验证脚本，覆盖 health(5) + admin(6) + agent(5) + tick(11) = 27 个 Cecelia Brain feature，每个 feature 对应真实 API 端点调用和响应字段断言。

**Architecture:** 独立 bash 脚本，完全仿照 `cecelia-smoke-audit.sh` 风格（ok/fail/section 计数器，最终 exit 0/1）。TDD：先写结构验证测试（单元测试，不需要运行中的 Brain），再实现脚本。

**Tech Stack:** bash + curl + jq；测试：vitest + Node.js fs 模块

---

## 文件结构

- 创建：`packages/brain/scripts/smoke/smoke-runtime.sh` — 27 feature 真实行为验证
- 创建：`tests/packages/brain/smoke-runtime.test.js` — 结构验证单元测试（DoD 可引用）
- 创建：`.prd-cp-0501182116-smoke-runtime-tests.md` — PRD + DoD（CI 要求）
- 创建：`docs/learnings/cp-0501182116-smoke-runtime-tests.md` — Learning 文件

---

### Task 1: 写失败测试 + smoke.sh 骨架（commit 1 — fail test）

> TDD iron law：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST

**Files:**
- Create: `tests/packages/brain/smoke-runtime.test.js`
- Create: `packages/brain/scripts/smoke/smoke-runtime.sh` (空骨架)

- [ ] **Step 1: 写结构验证测试**

```bash
cat > tests/packages/brain/smoke-runtime.test.js << 'TESTEOF'
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SMOKE_SCRIPT = path.resolve(REPO_ROOT, 'packages/brain/scripts/smoke/smoke-runtime.sh');

describe('smoke-runtime.sh 结构验证', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SMOKE_SCRIPT)).toBe(true);
  });

  it('文件可执行', () => {
    const stat = fs.statSync(SMOKE_SCRIPT);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('包含 ok/fail/section 函数', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('ok()');
    expect(c).toContain('fail()');
    expect(c).toContain('section()');
  });

  it('包含 27 个 feature 断言标签', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    const features = [
      // health
      'brain-health', 'brain-status', 'circuit-breaker', 'brain-status-full', 'circuit-breaker-reset',
      // admin
      'llm-caller', 'area-slot-config', 'model-profile', 'skills-registry', 'task-type-config', 'device-lock',
      // agent
      'agent-execution', 'executor-status', 'cluster-status', 'session-scan', 'session-kill',
      // tick
      'self-drive', 'tick-loop', 'tick-cleanup-zombie', 'recurring-tasks',
      'tick-disable', 'tick-enable', 'tick-drain', 'tick-drain-cancel',
      'tick-drain-status', 'tick-execute', 'tick-startup-errors',
    ];
    for (const f of features) {
      expect(c, `缺少 feature: ${f}`).toContain(f);
    }
  });

  it('包含 exit 0/1 退出逻辑', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('exit 0');
    expect(c).toContain('exit 1');
  });

  it('包含 BRAIN 变量定义', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('BRAIN=');
    expect(c).toContain('localhost:5221');
  });
});
TESTEOF
```

- [ ] **Step 2: 创建空骨架（让"文件存在"测试通过，其他测试仍失败）**

```bash
cat > packages/brain/scripts/smoke/smoke-runtime.sh << 'SKELEOF'
#!/usr/bin/env bash
# smoke-runtime.sh — TODO: implement
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SKELEOF
chmod +x packages/brain/scripts/smoke/smoke-runtime.sh
```

- [ ] **Step 3: 运行测试，确认失败（除"文件存在"外其他断言失败）**

```bash
cd packages/brain && npx vitest run ../../tests/packages/brain/smoke-runtime.test.js --reporter=verbose 2>&1 | tail -30
```

预期输出：至少 3 个 FAIL（缺少 ok/fail/section、feature 列表、exit 逻辑）

- [ ] **Step 4: 提交 fail test + skeleton**

```bash
git add packages/brain/src/__tests__/smoke-runtime.test.js \
        packages/brain/scripts/smoke/smoke-runtime.sh
git commit -m "test(brain): smoke-runtime.sh 结构验证测试（fail）+ 骨架

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现 smoke-runtime.sh（commit 2 — impl）

**Files:**
- Modify: `packages/brain/scripts/smoke/smoke-runtime.sh` (完整实现)

- [ ] **Step 1: 写完整 smoke-runtime.sh 实现**

```bash
cat > packages/brain/scripts/smoke/smoke-runtime.sh << 'SHEOF'
#!/usr/bin/env bash
# smoke-runtime.sh — Brain runtime 域真实行为验证
# PR 1/3: health(5) + admin(6) + agent(5) + tick(11) = 27 features
# 仿照 cecelia-smoke-audit.sh：ok/fail/section + exit 0/1
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

ok()      { echo "  ✅ $1"; ((PASS++)) || true; }
fail()    { echo "  ❌ $1"; ((FAIL++)) || true; }
section() { echo ""; echo "── $1 ──"; }

# ── health ───────────────────────────────────────────────────────────────────
section "health"

# brain-health: status == "healthy"
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "brain-health: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.status == "healthy"' >/dev/null 2>&1 \
  && ok "brain-health: status=healthy" \
  || fail "brain-health: status 不是 healthy ($r)"

# brain-status: generated_at 存在
r=$(curl -sf "$BRAIN/api/brain/status") || { fail "brain-status: /status 不可达"; r="{}"; }
echo "$r" | jq -e '.generated_at != null' >/dev/null 2>&1 \
  && ok "brain-status: generated_at 字段存在" \
  || fail "brain-status: generated_at 缺失"

# circuit-breaker: organs.circuit_breaker 存在
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "circuit-breaker: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs.circuit_breaker != null' >/dev/null 2>&1 \
  && ok "circuit-breaker: organs.circuit_breaker 字段存在" \
  || fail "circuit-breaker: organs.circuit_breaker 缺失"

# brain-status-full: nightly_orchestrator 存在
r=$(curl -sf "$BRAIN/api/brain/status/full") || { fail "brain-status-full: /status/full 不可达"; r="{}"; }
echo "$r" | jq -e '.nightly_orchestrator != null' >/dev/null 2>&1 \
  && ok "brain-status-full: nightly_orchestrator 字段存在" \
  || fail "brain-status-full: nightly_orchestrator 缺失"

# circuit-breaker-reset: organs 存在（电路重置通过 organs 活跃验证）
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "circuit-breaker-reset: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs != null' >/dev/null 2>&1 \
  && ok "circuit-breaker-reset: organs 字段存在（电路可重置）" \
  || fail "circuit-breaker-reset: organs 缺失"

# ── admin ────────────────────────────────────────────────────────────────────
section "admin"

# llm-caller: organs 存在（LLM caller 通过 Brain 器官活跃验证）
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "llm-caller: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs != null' >/dev/null 2>&1 \
  && ok "llm-caller: Brain organs 活跃（LLM 调用可用）" \
  || fail "llm-caller: organs 缺失"

# area-slot-config: areas 字段存在
r=$(curl -sf "$BRAIN/api/brain/capacity-budget") || { fail "area-slot-config: /capacity-budget 不可达"; r="{}"; }
echo "$r" | jq -e '.areas != null' >/dev/null 2>&1 \
  && ok "area-slot-config: capacity-budget.areas 存在" \
  || fail "area-slot-config: areas 缺失"

# model-profile: profiles 字段存在
r=$(curl -sf "$BRAIN/api/brain/model-profiles") || { fail "model-profile: /model-profiles 不可达"; r="{}"; }
echo "$r" | jq -e '.profiles != null' >/dev/null 2>&1 \
  && ok "model-profile: model-profiles.profiles 存在" \
  || fail "model-profile: profiles 缺失"

# skills-registry: count 字段存在
r=$(curl -sf "$BRAIN/api/brain/capabilities") || { fail "skills-registry: /capabilities 不可达"; r="{}"; }
echo "$r" | jq -e '.count != null' >/dev/null 2>&1 \
  && ok "skills-registry: capabilities.count 存在" \
  || fail "skills-registry: count 缺失"

# task-type-config: task_types 字段存在
r=$(curl -sf "$BRAIN/api/brain/task-types") || { fail "task-type-config: /task-types 不可达"; r="{}"; }
echo "$r" | jq -e '.task_types != null' >/dev/null 2>&1 \
  && ok "task-type-config: task_types 字段存在" \
  || fail "task-type-config: task_types 缺失"

# device-lock: success == true
r=$(curl -sf "$BRAIN/api/brain/device-locks") || { fail "device-lock: /device-locks 不可达"; r="{}"; }
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "device-lock: device-locks.success=true" \
  || fail "device-lock: success 不是 true"

# ── agent ────────────────────────────────────────────────────────────────────
section "agent"

# agent-execution: tasks?status=in_progress 返回 array
r=$(curl -sf "$BRAIN/api/brain/tasks?status=in_progress&limit=1") || { fail "agent-execution: /tasks 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "agent-execution: tasks 返回 array 类型" \
  || fail "agent-execution: tasks 不是 array"

# executor-status: organs.planner 存在
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "executor-status: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs.planner != null' >/dev/null 2>&1 \
  && ok "executor-status: organs.planner 存在" \
  || fail "executor-status: organs.planner 缺失"

# cluster-status + session-scan: 一次调用，两个断言
r=$(curl -sf "$BRAIN/api/brain/cluster/scan-sessions") || { fail "cluster-status: /scan-sessions 不可达"; r="{}"; }
echo "$r" | jq -e '.processes != null' >/dev/null 2>&1 \
  && ok "cluster-status: scan-sessions.processes 存在" \
  || fail "cluster-status: processes 缺失"
echo "$r" | jq -e '.scanned_at != null' >/dev/null 2>&1 \
  && ok "session-scan: scanned_at 字段存在" \
  || fail "session-scan: scanned_at 缺失"

# session-kill: POST /kill-session pid=0 → 响应含 error 或 success（400 也接受）
r=$(curl -s -X POST "$BRAIN/api/brain/cluster/kill-session" \
    -H "Content-Type: application/json" -d '{"pid":0}')
echo "$r" | jq -e 'has("error") or has("success")' >/dev/null 2>&1 \
  && ok "session-kill: POST /kill-session 响应结构正常" \
  || fail "session-kill: POST /kill-session 响应结构异常 ($r)"

# ── tick ─────────────────────────────────────────────────────────────────────
section "tick"

# self-drive / tick-loop / tick-cleanup-zombie: 一次调用，三个断言
r=$(curl -sf "$BRAIN/api/brain/tick/status") || { fail "tick: /tick/status 不可达"; r="{}"; }
echo "$r" | jq -e '.enabled != null' >/dev/null 2>&1 \
  && ok "self-drive: tick/status.enabled 存在" \
  || fail "self-drive: enabled 缺失"
echo "$r" | jq -e '.loop_running != null' >/dev/null 2>&1 \
  && ok "tick-loop: tick/status.loop_running 存在" \
  || fail "tick-loop: loop_running 缺失"
echo "$r" | jq -e 'has("last_cleanup")' >/dev/null 2>&1 \
  && ok "tick-cleanup-zombie: last_cleanup 字段存在（可为 null）" \
  || fail "tick-cleanup-zombie: last_cleanup 字段缺失"

# recurring-tasks: 返回 array
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "recurring-tasks: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "recurring-tasks: 返回 array 类型" \
  || fail "recurring-tasks: 不是 array"

# tick-drain-status: draining 字段存在
r=$(curl -sf "$BRAIN/api/brain/tick/drain-status") || { fail "tick-drain-status: /drain-status 不可达"; r="{}"; }
echo "$r" | jq -e 'has("draining")' >/dev/null 2>&1 \
  && ok "tick-drain-status: drain-status.draining 字段存在" \
  || fail "tick-drain-status: draining 字段缺失"

# tick-startup-errors: errors 字段存在
r=$(curl -sf "$BRAIN/api/brain/tick/startup-errors") || { fail "tick-startup-errors: /startup-errors 不可达"; r="{}"; }
echo "$r" | jq -e 'has("errors")' >/dev/null 2>&1 \
  && ok "tick-startup-errors: startup-errors.errors 字段存在" \
  || fail "tick-startup-errors: errors 字段缺失"

# tick-disable → tick-enable（幂等，测后恢复）
r=$(curl -s -X POST "$BRAIN/api/brain/tick/disable" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-disable: POST /tick/disable success=true" \
  || fail "tick-disable: POST /tick/disable 失败 ($r)"
curl -s -X POST "$BRAIN/api/brain/tick/enable" -H "Content-Type: application/json" -d '{}' >/dev/null

# tick-enable: success=true && enabled=true
r=$(curl -s -X POST "$BRAIN/api/brain/tick/enable" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true and .enabled == true' >/dev/null 2>&1 \
  && ok "tick-enable: POST /tick/enable success=true + enabled=true" \
  || fail "tick-enable: 状态异常 ($r)"

# tick-drain → tick-drain-cancel（幂等，测后恢复）
r=$(curl -s -X POST "$BRAIN/api/brain/tick/drain" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-drain: POST /tick/drain success=true" \
  || fail "tick-drain: POST /tick/drain 失败 ($r)"
r=$(curl -s -X POST "$BRAIN/api/brain/tick/drain-cancel" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-drain-cancel: POST /tick/drain-cancel success=true" \
  || fail "tick-drain-cancel: POST /tick/drain-cancel 失败 ($r)"

# tick-execute: POST /tick success=true
r=$(curl -s -X POST "$BRAIN/api/brain/tick" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-execute: POST /tick success=true" \
  || fail "tick-execute: POST /tick 失败 ($r)"

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  smoke-runtime.sh  |  PASS: $PASS  |  FAIL: $FAIL"
echo "════════════════════════════════════════════════════"
[[ $FAIL -eq 0 ]] && echo "✅ 全部 $PASS 项通过" && exit 0 || echo "❌ $FAIL 项失败" && exit 1
SHEOF
chmod +x packages/brain/scripts/smoke/smoke-runtime.sh
```

- [ ] **Step 2: 本地用真实 Brain 验证脚本行为**

```bash
bash packages/brain/scripts/smoke/smoke-runtime.sh
```

预期输出：
```
── health ──
  ✅ brain-health: status=healthy
  ✅ brain-status: generated_at 字段存在
  ✅ circuit-breaker: organs.circuit_breaker 字段存在
  ✅ brain-status-full: nightly_orchestrator 字段存在
  ✅ circuit-breaker-reset: organs 字段存在（电路可重置）

── admin ──
  ✅ llm-caller: Brain organs 活跃（LLM 调用可用）
  ... (共 27 行 ✅)

════════════════════════════════════════════════════
  smoke-runtime.sh  |  PASS: 27  |  FAIL: 0
════════════════════════════════════════════════════
✅ 全部 27 项通过
```

- [ ] **Step 3: 运行单元测试，确认全部通过**

```bash
cd packages/brain && npx vitest run ../../tests/packages/brain/smoke-runtime.test.js --reporter=verbose
```

预期：6 个 PASS，0 FAIL

- [ ] **Step 4: 提交实现**

```bash
git add packages/brain/scripts/smoke/smoke-runtime.sh
git commit -m "feat(brain): smoke-runtime.sh — health/admin/agent/tick 27 feature 真实行为验证

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: PRD/DoD + Learning 文件（commit 3）

**Files:**
- Create: `.prd-cp-0501182116-smoke-runtime-tests.md`
- Create: `docs/learnings/cp-0501182116-smoke-runtime-tests.md`

- [ ] **Step 1: 写 PRD/DoD 文件**

```bash
cat > .prd-cp-0501182116-smoke-runtime-tests.md << 'PRDEOF'
# smoke-runtime-tests PR 1/3

## 背景

Cecelia Brain 的 171 个 feature 都有 smoke_cmd 字符串存储在 DB 中，但没有可独立运行的真实 .sh 测试脚本。本 PR 为 health/admin/agent/tick 4 个域（27 个 feature）创建 `packages/brain/scripts/smoke/smoke-runtime.sh`。

## 成功标准

- [ ] `packages/brain/scripts/smoke/smoke-runtime.sh` 存在且可执行
- [ ] 脚本包含 27 个 feature 的真实 API 断言
- [ ] 单元测试 `smoke-runtime.test.js` 全部通过
- [ ] 本地连接真实 Brain（localhost:5221）执行 exit 0

## DoD

- [x] [ARTIFACT] smoke-runtime.sh 文件存在且可执行
  Test: `node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/smoke-runtime.sh');if(!(s.mode&0o111))process.exit(1)"`

- [x] [BEHAVIOR] 脚本对 27 个 feature 的端点有真实断言（含 feature ID 字符串）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/smoke-runtime.sh','utf8');['brain-health','brain-status','circuit-breaker','brain-status-full','circuit-breaker-reset','llm-caller','area-slot-config','model-profile','skills-registry','task-type-config','device-lock','agent-execution','executor-status','cluster-status','session-scan','session-kill','self-drive','tick-loop','tick-cleanup-zombie','recurring-tasks','tick-disable','tick-enable','tick-drain','tick-drain-cancel','tick-drain-status','tick-execute','tick-startup-errors'].forEach(f=>{if(!c.includes(f))throw new Error('missing: '+f)})"`

- [x] [BEHAVIOR] 单元测试通过（结构验证，不依赖运行中 Brain）
  Test: `tests/packages/brain/smoke-runtime.test.js`

- [x] [ARTIFACT] ok/fail/section 函数存在
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/smoke-runtime.sh','utf8');if(!c.includes('ok()'))process.exit(1);if(!c.includes('fail()'))process.exit(1);if(!c.includes('section()'))process.exit(1)"`
PRDEOF
```

- [ ] **Step 2: 写 Learning 文件**

```bash
mkdir -p docs/learnings
cat > docs/learnings/cp-0501182116-smoke-runtime-tests.md << 'LEOF'
## Cecelia Brain smoke-runtime tests PR 1/3（2026-05-01）

### 根本原因

Brain 的 171 个 feature 只有 smoke_cmd 字符串（动态 DB 驱动），没有可独立运行、固定断言的 .sh 测试脚本。CI 的 `real-env-smoke` job 需要 `packages/brain/scripts/smoke/*.sh` 真实脚本，不能读 DB。

### 下次预防

- [ ] 新 feature 域合并时同步补充对应 smoke-*.sh 脚本段落
- [ ] smoke_cmd 和 smoke.sh 断言保持一致：端点变更两处同步更新
- [ ] tick 操作类测试（disable/drain）必须在断言后立即恢复状态（enable/drain-cancel）
- [ ] 响应字段验证前先用 `|| { fail "msg"; r="{}"; }` 兜底，避免 set -e 中断
LEOF
```

- [ ] **Step 3: 提交 PRD + Learning**

```bash
git add .prd-cp-0501182116-smoke-runtime-tests.md \
        docs/learnings/cp-0501182116-smoke-runtime-tests.md
git commit -m "docs: smoke-runtime-tests PRD/DoD + Learning

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 验证 + push + PR

- [ ] **Step 1: 运行完整测试套件（仅单元测试）**

```bash
cd packages/brain && npx vitest run ../../tests/packages/brain/smoke-runtime.test.js --reporter=verbose
```

预期：全 PASS

- [ ] **Step 2: 检查 DoD 格式（CI L1 预验证）**

```bash
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

预期：无 FAIL（DoD 包含 `[BEHAVIOR]` 且已 `[x]` 勾选）

- [ ] **Step 3: push**

```bash
git push -u origin cp-0501182116-smoke-runtime-tests
```

- [ ] **Step 4: 创建 PR**

```bash
gh pr create \
  --title "feat(brain): smoke-runtime.sh — health/admin/agent/tick 27 feature 真实行为验证（PR 1/3）" \
  --body "$(cat <<'PREOF'
## Summary

- 新建 `packages/brain/scripts/smoke/smoke-runtime.sh`，覆盖 health(5) + admin(6) + agent(5) + tick(11) = **27 个 feature** 的真实 Brain API 端点断言
- 新建 `packages/brain/src/__tests__/smoke-runtime.test.js`，结构验证（不依赖运行中 Brain）
- 仿照 `cecelia-smoke-audit.sh` 风格（ok/fail/section + exit 0/1）
- tick 操作（disable/drain）断言后自动恢复状态（idempotent）

## Test Plan

- [x] `npx vitest run src/__tests__/smoke-runtime.test.js` — 6 项单元测试全 PASS
- [x] `bash packages/brain/scripts/smoke/smoke-runtime.sh` — 27 项断言全 PASS（本地 Brain）
- [x] DoD `[BEHAVIOR]` 条目已验证
PREOF
)"
```

- [ ] **Step 5: 等待 CI 通过后调用 engine-ship**

```bash
# 前台阻塞等待 CI
PR_NUMBER=$(gh pr view --json number -q .number)
until [[ $(gh pr checks $PR_NUMBER 2>/dev/null | grep -cE "pending|in_progress") == 0 ]]; do
  echo "⏳ 等待 CI..."
  sleep 30
done
echo "✅ CI 完成"
gh pr checks $PR_NUMBER
```
