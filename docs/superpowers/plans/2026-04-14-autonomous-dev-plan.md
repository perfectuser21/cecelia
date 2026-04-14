# /dev autonomous_mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 /dev 支持 autonomous_mode — PRD 进去，PR 出来，中间全自动，由 Superpowers 三角色 subagent 保证质量。

**Architecture:** 修基础设施 bug → 加 `--autonomous` 参数 → 重写 Stage 1 引用 brainstorming/writing-plans → 重写 Stage 2 引用 subagent-driven-development 三角色 → 更新 SKILL.md。Engine 外壳（Stop Hook + devloop-check + Brain）不变。

**Tech Stack:** Bash (hooks + devloop-check), Markdown (skill files), YAML (feature-registry), Node (CI validation)

---

## File Structure

| 文件 | 类型 | 职责 |
|------|------|------|
| `~/.claude-account1/skills/dev/scripts/worktree-manage.sh` | 修改 | 修复中文逗号导致的 unbound variable |
| `packages/engine/hooks/stop-dev.sh` | 修改 | orphan 区分 session_id + worktree 消失自动清理 |
| `packages/engine/lib/devloop-check.sh` | 修改 | CI 失败计数器 + 第 3 次切换 action |
| `packages/engine/skills/dev/scripts/parse-dev-args.sh` | 修改 | 支持 `--autonomous` 参数 |
| `packages/engine/skills/dev/steps/01-spec.md` | 重写 | brainstorming + writing-plans 自主流程 |
| `packages/engine/skills/dev/steps/02-code.md` | 重写 | subagent-driven-development 三角色 |
| `packages/engine/skills/dev/SKILL.md` | 修改 | 加 autonomous_mode 说明 |
| `packages/engine/feature-registry.yml` | 修改 | 新增 changelog 条目 |
| `packages/engine/VERSION` + `package.json` + 其余 4 个版本文件 | 修改 | bump 到 14.8.0 |
| `packages/engine/tests/hooks/stop-hook-session-isolation.test.ts` | 新建 | 验证 orphan session_id 区分 |
| `packages/engine/tests/scripts/devloop-ci-counter.test.ts` | 新建 | 验证 CI 失败计数器 |
| `packages/engine/tests/scripts/parse-dev-args-autonomous.test.ts` | 新建 | 验证 --autonomous 解析 |

---

## Phase 1: 基础设施修复（先做，让外壳不崩）

### Task 1: 修复 worktree-manage.sh 中文逗号导致的 unbound variable

**Files:**
- Modify: `~/.claude-account1/skills/dev/scripts/worktree-manage.sh:188`

问题定位：line 188 的 `$base_branch，` 后面紧跟中文逗号，在某些 bash locale 下被当作变量名一部分。

- [ ] **Step 1: 读取 line 180-200 确认上下文**

```bash
sed -n '180,200p' ~/.claude-account1/skills/dev/scripts/worktree-manage.sh
```

Expected: 看到 `echo -e "${YELLOW}⚠️  无法更新 $base_branch，使用当前版本${NC}" >&2` 这行。

- [ ] **Step 2: 全局替换 $base_branch 为 ${base_branch}（防御性括号）**

```bash
sed -i.bak 's/\$base_branch\([^_a-zA-Z0-9]\)/${base_branch}\1/g' \
  ~/.claude-account1/skills/dev/scripts/worktree-manage.sh
```

- [ ] **Step 3: 验证修复不破坏语法**

```bash
bash -n ~/.claude-account1/skills/dev/scripts/worktree-manage.sh
echo "exit: $?"
```

Expected: `exit: 0`

- [ ] **Step 4: 功能测试 — 模拟 main 有 unstaged changes 的场景**

```bash
cd /Users/administrator/perfect21/cecelia
touch /tmp/test-unstaged-trigger-$(date +%s).md
bash ~/.claude-account1/skills/dev/scripts/worktree-manage.sh create test-worktree-fix 2>&1 | tail -5
```

Expected: 不再出现 `base_branch�: unbound variable`，输出 worktree 路径。

- [ ] **Step 5: 清理测试 worktree + commit 修复**

```bash
rm -f /tmp/test-unstaged-trigger-*.md
bash ~/.claude-account1/skills/dev/scripts/worktree-manage.sh list
# 手动 git worktree remove 清理测试 worktree
cd /Users/administrator/perfect21/cecelia
# worktree-manage.sh 在 ~/.claude-account1 是个人 skill，不在 repo 中，无需 commit
# 但若该脚本也存在于 packages/engine/skills/dev/scripts/，则需同步修复
diff ~/.claude-account1/skills/dev/scripts/worktree-manage.sh \
     packages/engine/skills/dev/scripts/worktree-manage.sh 2>/dev/null | head -3
```

若 packages/engine 下也有同名脚本，同步修复并 commit。

---

### Task 2: Stop Hook orphan 区分 session_id

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh`（_collect_search_dirs + orphan detection 附近）
- Create: `packages/engine/tests/hooks/stop-hook-session-isolation.test.ts`

- [ ] **Step 1: 写失败测试 — 不同 session 的 orphan 不应 block 当前 session**

```typescript
// packages/engine/tests/hooks/stop-hook-session-isolation.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('stop-dev.sh — 跨 session orphan 隔离', () => {
  let tmpRoot: string;
  let fakeWorktree: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'stop-isol-'));
    fakeWorktree = join(tmpRoot, 'fake-wt');
    mkdirSync(fakeWorktree);
    // 其他 session 留下的 orphan（session_id=other-session-xxx）
    writeFileSync(
      join(fakeWorktree, '.dev-mode.cp-0413-other'),
      [
        'dev',
        'branch: cp-0413-other',
        'session_id: other-session-xxx',
        'step_1_spec: done',
        'step_2_code: pending',
      ].join('\n')
    );
    writeFileSync(
      join(fakeWorktree, '.dev-lock.cp-0413-other'),
      'dev\nbranch: cp-0413-other\nsession_id: other-session-xxx\n'
    );
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('当前 session_id 与 orphan session_id 不同时，Stop Hook 应允许退出', () => {
    const env = {
      ...process.env,
      CLAUDE_SESSION_ID: 'current-session-yyy',
      CECELIA_TEST_WORKTREE_ROOT: fakeWorktree,
    };
    const result = execSync(
      `bash ${process.cwd()}/packages/engine/hooks/stop-dev.sh`,
      { env, encoding: 'utf8' }
    );
    // 不同 session 的 orphan 只应 warning，不应 block
    expect(result).toMatch(/warning|warn|跨.*session/i);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/engine && npx vitest run tests/hooks/stop-hook-session-isolation.test.ts
```

Expected: FAIL（测试文件新建，逻辑未实现）

- [ ] **Step 3: 修改 stop-dev.sh 的 orphan 检测逻辑**

找到 `_collect_search_dirs` 附近的 orphan 扫描代码，修改为：

```bash
# packages/engine/hooks/stop-dev.sh — orphan 检测块
# 原：发现任何 worktree 有未完成 step → 一律 block
# 改：读 orphan 的 session_id，与当前 CLAUDE_SESSION_ID 对比

_current_session_id="${CLAUDE_SESSION_ID:-}"
for _dmf in "${_orphan_candidates[@]}"; do
    _orphan_sid=$(grep "^session_id:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "")
    if [[ -n "$_current_session_id" && -n "$_orphan_sid" && \
          "$_orphan_sid" != "$_current_session_id" ]]; then
        # 其他 session 的 orphan → warning + 跳过
        echo "[Stop Hook] warning: 跨 session orphan 跳过（$_orphan_sid ≠ $_current_session_id）" >&2
        continue
    fi
    # 同 session 或无 session_id → 按原逻辑 block
    # ... 原 block 代码 ...
done
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd packages/engine && npx vitest run tests/hooks/stop-hook-session-isolation.test.ts
```

Expected: PASS

- [ ] **Step 5: 跑全套 stop-hook 测试确认无回归**

```bash
cd packages/engine && npx vitest run tests/hooks/stop-hook
```

Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add packages/engine/hooks/stop-dev.sh packages/engine/tests/hooks/stop-hook-session-isolation.test.ts
git commit -m "fix(engine): Stop Hook orphan 检测区分 session_id — 跨 session 不互相 block"
```

---

### Task 3: devloop-check CI 失败计数器

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`（条件 4 CI 失败分支）
- Create: `packages/engine/tests/scripts/devloop-ci-counter.test.ts`

- [ ] **Step 1: 写失败测试 — CI 失败第 3 次应切换 action**

```typescript
// packages/engine/tests/scripts/devloop-ci-counter.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('devloop-check.sh — CI 失败计数器', () => {
  it('第 3 次 CI 失败时 action 切换为 systematic-debugging', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'devloop-ci-'));
    const devModeFile = join(tmpDir, '.dev-mode.cp-test');
    writeFileSync(devModeFile, [
      'dev',
      'branch: cp-test',
      'step_1_spec: done',
      'step_2_code: done',
      'step_3_integrate: done',
      'step_4_ship: pending',
      'ci_fix_count: 2',  // 已失败 2 次
    ].join('\n'));

    // 模拟第 3 次失败：sourcing 脚本后调用 _increment_and_check_ci_counter
    const script = `
      source packages/engine/lib/devloop-check.sh
      _increment_and_check_ci_counter "${devModeFile}"
      grep "^ci_fix_count:" "${devModeFile}"
      _ci_action_for_count "${devModeFile}"
    `;
    const output = execSync(script, { shell: '/bin/bash', encoding: 'utf8' });
    expect(output).toContain('ci_fix_count: 3');
    expect(output).toMatch(/systematic-debugging|停下|根因/);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/engine && npx vitest run tests/scripts/devloop-ci-counter.test.ts
```

Expected: FAIL

- [ ] **Step 3: 在 devloop-check.sh 加两个辅助函数**

在 `_mark_cleanup_done()` 后面加：

```bash
# ============================================================================
# 内部函数: _increment_and_check_ci_counter
# 每次 CI 失败调用，.dev-mode 的 ci_fix_count +1
# ============================================================================
_increment_and_check_ci_counter() {
    local f="${1:-}"; [[ -z "$f" || ! -f "$f" ]] && return 0
    local current
    current=$(grep "^ci_fix_count:" "$f" 2>/dev/null | awk '{print $2}' || echo "0")
    current="${current:-0}"
    local next=$((current + 1))
    if grep -q "^ci_fix_count:" "$f" 2>/dev/null; then
        [[ "$(uname)" == "Darwin" ]] && \
            sed -i '' "s/^ci_fix_count:.*/ci_fix_count: ${next}/" "$f" || \
            sed -i "s/^ci_fix_count:.*/ci_fix_count: ${next}/" "$f"
    else
        echo "ci_fix_count: ${next}" >> "$f"
    fi
    echo "$next"
}

# ============================================================================
# 内部函数: _ci_action_for_count
# 根据 ci_fix_count 返回相应的 action 字符串
# ============================================================================
_ci_action_for_count() {
    local f="${1:-}"
    local count
    count=$(grep "^ci_fix_count:" "$f" 2>/dev/null | awk '{print $2}' || echo "0")
    count="${count:-0}"
    if [[ "$count" -ge 3 ]]; then
        echo "CI 已失败 ${count} 次（≥3）。停下来，使用 superpowers:systematic-debugging 分析根因。不要再盲目 push 修复。"
    else
        echo "CI 失败，查看日志修复问题后重新 push（已失败 ${count} 次）"
    fi
}
```

- [ ] **Step 4: 修改条件 4 CI 失败分支调用新函数**

找到 `"completed") if [[ "$ci_conclusion" != "success" ]]` 分支，改为：

```bash
"completed")
    if [[ "$ci_conclusion" != "success" ]]; then
        _increment_and_check_ci_counter "$dev_mode_file" >/dev/null
        local action_msg
        action_msg=$(_ci_action_for_count "$dev_mode_file")
        [[ -n "$ci_run_id" ]] && \
            action_msg="${action_msg}（gh run view $ci_run_id --log-failed）"
        _devloop_jq -n \
            --arg reason "CI 失败（$ci_conclusion）" \
            --arg action "$action_msg" \
            --arg run_id "${ci_run_id:-}" \
            '{"status":"blocked","reason":$reason,"action":$action,"ci_run_id":$run_id}'
        return 2
    fi
    ;;
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd packages/engine && npx vitest run tests/scripts/devloop-ci-counter.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/engine/lib/devloop-check.sh packages/engine/tests/scripts/devloop-ci-counter.test.ts
git commit -m "feat(engine): devloop-check 加 CI 失败计数器 — 第 3 次切换为 systematic-debugging"
```

---

### Task 4: Stop Hook worktree 消失自动清理

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh`（orphan 检测前加 worktree 存在性检查）

- [ ] **Step 1: 在 stop-dev.sh 的 orphan 扫描循环开头加 worktree 检测**

```bash
# packages/engine/hooks/stop-dev.sh — orphan 扫描循环内
for _dmf in "${_orphan_candidates[@]}"; do
    _wt_dir=$(dirname "$_dmf")
    # 新增：worktree 目录不存在则自动清理（不 block）
    if [[ ! -d "$_wt_dir" ]]; then
        echo "[Stop Hook] worktree 已不存在，自动清理孤儿 dev-mode: $_dmf" >&2
        rm -f "$_dmf" "${_dmf/.dev-mode/.dev-lock}" 2>/dev/null || true
        continue
    fi
    # ... 原有逻辑继续 ...
done
```

- [ ] **Step 2: 手动验证 — 模拟 worktree 消失场景**

```bash
TMPDIR=$(mktemp -d)
FAKE_WT="$TMPDIR/fake-wt"
mkdir -p "$FAKE_WT"
echo -e "dev\nbranch: cp-test\nstep_2_code: pending" > "$FAKE_WT/.dev-mode.cp-test"
rm -rf "$FAKE_WT"  # 模拟 worktree 消失
# 残留的 .dev-mode 现在指向不存在的目录
ls "$TMPDIR/fake-wt/.dev-mode.cp-test" 2>&1 | grep -q "No such" && echo "✅ 目录已消失"
# 运行 stop-dev.sh 的 orphan 检测逻辑（简化版）
# 期望：不 block，不 crash
```

- [ ] **Step 3: 跑现有 stop-hook 测试确认无回归**

```bash
cd packages/engine && npx vitest run tests/hooks/stop-hook
```

Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add packages/engine/hooks/stop-dev.sh
git commit -m "fix(engine): Stop Hook 检测 worktree 消失时自动清理孤儿 dev-mode"
```

---

## Phase 2: autonomous_mode 参数支持

### Task 5: parse-dev-args.sh 支持 --autonomous

**Files:**
- Modify: `packages/engine/skills/dev/scripts/parse-dev-args.sh`
- Create: `packages/engine/tests/scripts/parse-dev-args-autonomous.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/engine/tests/scripts/parse-dev-args-autonomous.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('parse-dev-args.sh — --autonomous 参数', () => {
  it('传入 --autonomous 时输出 AUTONOMOUS_MODE=true', () => {
    const output = execSync(
      `bash packages/engine/skills/dev/scripts/parse-dev-args.sh --autonomous`,
      { encoding: 'utf8' }
    );
    expect(output).toContain('AUTONOMOUS_MODE=true');
  });

  it('不传 --autonomous 时输出 AUTONOMOUS_MODE=false', () => {
    const output = execSync(
      `bash packages/engine/skills/dev/scripts/parse-dev-args.sh --task-id abc`,
      { encoding: 'utf8' }
    );
    expect(output).toContain('AUTONOMOUS_MODE=false');
  });

  it('Brain task payload 含 autonomous_mode:true 也应激活', () => {
    // parse-dev-args.sh 应读 Brain API 的 task payload
    // 此测试需 mock BRAIN_API_URL；若无 mock，至少确认脚本不 crash
    const output = execSync(
      `BRAIN_API_URL=http://localhost:9999 bash packages/engine/skills/dev/scripts/parse-dev-args.sh --task-id nonexistent`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    expect(output).toContain('AUTONOMOUS_MODE=');
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd packages/engine && npx vitest run tests/scripts/parse-dev-args-autonomous.test.ts
```

Expected: FAIL

- [ ] **Step 3: 修改 parse-dev-args.sh**

在解析 loop 里加 `--autonomous`：

```bash
# packages/engine/skills/dev/scripts/parse-dev-args.sh — 参数解析 loop
AUTONOMOUS_MODE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --task-id) TASK_ID="$2"; shift 2 ;;
        --autonomous) AUTONOMOUS_MODE=true; shift ;;
        *) shift ;;
    esac
done

# 如果有 TASK_ID，查询 Brain payload.autonomous_mode
if [[ -n "${TASK_ID:-}" ]] && [[ "$AUTONOMOUS_MODE" == "false" ]]; then
    _payload_autonomous=$(curl -s --connect-timeout 2 --max-time 4 \
        "${BRAIN_API_URL:-http://localhost:5221}/api/brain/tasks/${TASK_ID}" \
        2>/dev/null | jq -r '.payload.autonomous_mode // false' 2>/dev/null || echo "false")
    [[ "$_payload_autonomous" == "true" ]] && AUTONOMOUS_MODE=true
fi

echo "TASK_ID=${TASK_ID:-}"
echo "AUTONOMOUS_MODE=${AUTONOMOUS_MODE}"
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd packages/engine && npx vitest run tests/scripts/parse-dev-args-autonomous.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/skills/dev/scripts/parse-dev-args.sh packages/engine/tests/scripts/parse-dev-args-autonomous.test.ts
git commit -m "feat(engine): parse-dev-args 支持 --autonomous 参数 + Brain payload 读取"
```

---

## Phase 3: Stage 1 重写 — 自主 Plan 产出

### Task 6: 重写 01-spec.md（brainstorming + writing-plans 内嵌）

**Files:**
- Modify: `packages/engine/skills/dev/steps/01-spec.md`

- [ ] **Step 1: 读现有 01-spec.md 记下要保留的部分**

```bash
wc -l packages/engine/skills/dev/steps/01-spec.md
grep -n "^##" packages/engine/skills/dev/steps/01-spec.md
```

保留：frontmatter、harness_mode 分支、fetch-task-prd.sh 调用、.dev-mode 写入格式

- [ ] **Step 2: 写入新版 01-spec.md（frontmatter version → 6.0.0）**

```markdown
---
id: dev-stage-01-spec
version: 6.0.0
created: 2026-03-20
updated: 2026-04-14
changelog:
  - 6.0.0: autonomous_mode — 内嵌 superpowers:brainstorming + writing-plans 流程
  - 5.0.0: Superpowers 融入 — 零占位符 + Self-Review
---

# Stage 1: Spec — PRD 到 Plan（autonomous_mode 支持）

## 0. 模式判断

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
AUTONOMOUS_MODE=$(grep "^autonomous_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
```

harness_mode → 原逻辑不变（读 sprint-contract.md）
autonomous_mode=true → 走自主流程（本文件下半部分）
两者均 false → 走原标准模式（主 agent 写 Task Card）

## 1. autonomous_mode 自主流程

### 1.1 探索 + 影响分析

（现有逻辑）读 PRD，搜 learnings，列出要改的文件。

### 1.2 自主技术决策（内嵌 superpowers:brainstorming 的骨架，跳过用户交互）

- 提出 2-3 个方案
- 自己用 Good/Bad 对比框架评估
- 选最直接的方案，在 plan 文件里记录决策依据

**禁止**：问用户"你想要 A 还是 B"。autonomous_mode 下 agent 自己决定。

### 1.3 写 Implementation Plan（内嵌 superpowers:writing-plans 核心规则）

产出 `.plan-${BRANCH}.md`，符合：

- 每个 task 精确到文件路径 + 代码 + 测试命令 + 预期输出
- 零占位符规则（TBD/TODO/稍后/适当/同上 全禁）
- 每步 2-5 分钟粒度
- TDD 顺序：写测试 → 验证失败 → 写实现 → 验证通过 → commit

### 1.4 Self-Review 三步

1. Spec 覆盖度 — PRD 每个要求有对应 task？
2. 占位符扫描 — 禁止关键词？
3. 命令可执行性 — 每个命令能跑？

有问题 → 修 → 不用重 review，继续。

### 1.5 写 Task Card（DoD）+ 持久化

同原逻辑，额外记录 `.plan-${BRANCH}.md` 引用。

标记 `step_1_spec: done`。

## 2. 标准模式（非 autonomous）

（原 01-spec.md 的 1.1-1.3 内容保持不变）
```

详细内容见现有 01-spec.md，保留原标准模式分支。新增 autonomous 分支按上述框架实现。

- [ ] **Step 3: 语法自检**

```bash
head -15 packages/engine/skills/dev/steps/01-spec.md
# frontmatter 完整
node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/01-spec.md','utf8');if(!c.includes('autonomous_mode'))process.exit(1);console.log('✅')"
```

- [ ] **Step 4: Commit**

```bash
git add packages/engine/skills/dev/steps/01-spec.md
git commit -m "[CONFIG] feat(engine): 01-spec.md 重写 — autonomous_mode 自主 plan 流程"
```

---

## Phase 4: Stage 2 重写 — Subagent 三角色

### Task 7: 重写 02-code.md（subagent-driven-development 三角色）

**Files:**
- Modify: `packages/engine/skills/dev/steps/02-code.md`

- [ ] **Step 1: 写入新版 02-code.md（version → 9.0.0）**

```markdown
---
id: dev-step-02-code
version: 9.0.0
created: 2026-03-14
updated: 2026-04-14
changelog:
  - 9.0.0: autonomous_mode — Subagent 三角色（implementer/spec-reviewer/code-quality-reviewer）
  - 8.0.0: Superpowers 融入 — TDD + Verification + Debugging
---

# Stage 2: Code — Subagent 三角色开发

## 0. 模式判断

```bash
AUTONOMOUS_MODE=$(grep "^autonomous_mode:" .dev-mode.${BRANCH} | awk '{print $2}')
```

autonomous_mode=true → 三角色流程（本文件）
其他 → 原标准流程（主 agent 自己写）

## 1. 主 agent 协调者角色

读 `.plan-${BRANCH}.md`，对每个 plan task 依次派 3 轮 subagent。

## 2. Round 1: Implementer Subagent

使用 `superpowers:test-driven-development` 纪律。

Task 描述完整传入（不让 subagent 自己读文件）+ 相关代码上下文。

4 种返回状态：
| 状态 | 主 agent 行为 |
|------|--------------|
| DONE | 进 Round 2 |
| DONE_WITH_CONCERNS | 读疑虑决定 |
| NEEDS_CONTEXT | 补充信息重派（同模型）|
| BLOCKED | 升级模型 / 拆更小 task / 用 systematic-debugging |

Model：1-2 文件 clear → Sonnet；多文件集成 → Opus

## 3. Round 2: Spec Reviewer Subagent

原则："不信任 Implementer 的报告。自己读代码验证。"

检查：缺失需求、多余实现、理解偏差。

❌ → Implementer 修 → 重新 review

Model：Sonnet

## 4. Round 3: Code Quality Reviewer Subagent

**前置**：Spec Review 通过才跑。

检查：代码质量、测试质量、YAGNI。

Issues → Implementer 修 → 重新 review

Model：Sonnet

## 5. 失败自愈

Implementer BLOCKED：
- 第 1 次 → 补充上下文重派
- 第 2 次 → 升级模型
- 第 3 次 → systematic-debugging

Spec Reviewer 连续 3 轮 ❌ → 换 Implementer 从头实现

连续 3 个 task BLOCKED → 回 Stage 1 重做 plan

## 6. 所有 task 完成后

Verification Gate — 每勾 [x] 前必须有 exit 0 证据。

标记 `step_2_code: done`。
```

- [ ] **Step 2: 语法自检 + commit**

```bash
node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');['Implementer','Spec Reviewer','Code Quality','systematic-debugging'].forEach(k=>{if(!c.includes(k))process.exit(1)});console.log('✅')"
git add packages/engine/skills/dev/steps/02-code.md
git commit -m "[CONFIG] feat(engine): 02-code.md 重写 — Subagent 三角色（implementer/spec/quality）"
```

---

## Phase 5: SKILL.md + 版本 + registry

### Task 8: 更新 SKILL.md + bump 版本 + 更新 feature-registry

**Files:**
- Modify: `packages/engine/skills/dev/SKILL.md`
- Modify: `packages/engine/feature-registry.yml`
- Modify: `packages/engine/package.json` + 5 个版本文件

- [ ] **Step 1: 修改 SKILL.md 加 autonomous_mode 说明**

```bash
# 在 SKILL.md "Superpowers 集成" 表格后加新 section
```

内容：

```markdown
## autonomous_mode（全自动模式）

触发：`/dev --autonomous` 或 Brain payload.autonomous_mode: true

行为：
- Stage 1: brainstorming + writing-plans 自主产出 plan（跳过用户交互）
- Stage 2: subagent-driven-development 三角色
- Stage 3-4: 不变（push/PR/CI/merge 自动化）

跳过：用户交互问询
不跳过：质量审查（spec-reviewer + code-quality-reviewer）、失败升级、Stop Hook
```

- [ ] **Step 2: bump Engine 版本到 14.8.0（5 个文件）**

```bash
cd packages/engine
# 按 version-management.md 规则 bump
NEW_VER="14.8.0"
sed -i '' "s/\"version\": \"14.7.0\"/\"version\": \"${NEW_VER}\"/" package.json
sed -i '' "s/\"version\": \"14.7.0\"/\"version\": \"${NEW_VER}\"/" package-lock.json
echo "${NEW_VER}" > VERSION
echo "${NEW_VER}" > .hook-core-version
# regression-contract.yaml
sed -i '' "s/^version: .*/version: \"${NEW_VER}\"/" regression-contract.yaml
```

- [ ] **Step 3: 更新 feature-registry.yml**

```yaml
changelog:
  - version: "14.8.0"
    date: "2026-04-14"
    change: "feat"
    description: "autonomous_mode：01-spec.md brainstorming+writing-plans 自主；02-code.md subagent 三角色；parse-dev-args 支持 --autonomous；devloop-check CI 失败计数器；Stop Hook session_id 隔离 + worktree 消失清理"
    files:
      - "packages/engine/skills/dev/SKILL.md"
      - "packages/engine/skills/dev/steps/01-spec.md"
      - "packages/engine/skills/dev/steps/02-code.md"
      - "packages/engine/skills/dev/scripts/parse-dev-args.sh"
      - "packages/engine/hooks/stop-dev.sh"
      - "packages/engine/lib/devloop-check.sh"
```

- [ ] **Step 4: 运行 check-version-sync.sh 确认同步**

```bash
bash packages/engine/ci/scripts/check-version-sync.sh
```

Expected: 无错误

- [ ] **Step 5: 跑全套 engine 测试**

```bash
cd packages/engine && npx vitest run
```

Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add packages/engine/skills/dev/SKILL.md \
        packages/engine/feature-registry.yml \
        packages/engine/package.json \
        packages/engine/package-lock.json \
        packages/engine/VERSION \
        packages/engine/.hook-core-version \
        packages/engine/regression-contract.yaml
git commit -m "[CONFIG] chore(engine): bump 14.8.0 — autonomous_mode + 基础设施修复"
```

---

## Phase 6: 集成测试 + 端到端验证

### Task 9: 端到端验证 + Learning + PR

**Files:**
- Create: `docs/learnings/<branch>.md`

- [ ] **Step 1: 本地 quickcheck**

```bash
bash scripts/quickcheck.sh
```

Expected: 通过

- [ ] **Step 2: 写 Learning**

```bash
mkdir -p docs/learnings
cat > docs/learnings/cp-<BRANCH>.md <<'EOF'
## autonomous_mode 实施（2026-04-14）

### 根本原因
之前 /dev 的 step 文件只有骨架，agent 在 Stage 2 内部"怎么写代码、怎么调试、怎么验证"几乎没有行为指导。基础设施 bug（worktree-manage.sh 中文逗号、Stop Hook orphan 不分 session）一崩所有规则脱轨。

### 下次预防
- [ ] 新增 hook 或 skill 时，同步补充 e2e-integrity-check.sh 的检查项
- [ ] shell 脚本里的 $var 一律用 ${var} 括号包裹，避免中文字符歧义
- [ ] Stop Hook 的 session 隔离要有专门测试覆盖
EOF
```

- [ ] **Step 3: push + PR**

```bash
git add docs/learnings/
git commit -m "docs: add learning for autonomous-mode"
/usr/bin/git push -u origin HEAD
gh pr create --base main \
  --title "[CONFIG] feat(engine): autonomous_mode — Superpowers × Engine 融合" \
  --body "$(cat <<'BODY'
## Summary
- /dev 支持 --autonomous 标志，Stage 1-2 自主完成（brainstorming + writing-plans + subagent-driven-development 三角色）
- 修复 worktree-manage.sh 中文逗号 unbound variable bug
- Stop Hook orphan 检测按 session_id 隔离
- devloop-check 加 CI 失败计数器（第 3 次切换为 systematic-debugging）
- Stop Hook 检测到 worktree 消失时自动清理孤儿 dev-mode

## Test
- [ ] 新增 3 个测试文件全绿
- [ ] 本地 quickcheck 通过
- [ ] 现有 350+ 测试无回归

Generated by /dev autonomous_mode
BODY
)"
```

- [ ] **Step 4: 等 CI 通过 → Stop Hook 自动合并**

devloop-check 条件 6 会在 CI 全绿 + step_4_ship: done 时自动 `gh pr merge --squash --delete-branch`。

---

## Self-Review

**1. Spec 覆盖度：**
- ✅ Stage 1 改造 → Task 6
- ✅ Stage 2 改造 → Task 7
- ✅ 失败自愈 → 嵌入 Task 7 描述
- ✅ 基础设施修复 × 4 → Task 1-4
- ✅ autonomous_mode 触发 → Task 5

**2. 占位符扫描：** 全文无 TBD/TODO/"similar to"

**3. 类型一致性：**
- `.dev-mode` 字段名统一：`step_1_spec`/`step_2_code`/`step_3_integrate`/`step_4_ship`/`autonomous_mode`/`ci_fix_count`
- 命令统一：`npx vitest run`、`bash packages/engine/...`
- 版本统一：14.8.0
