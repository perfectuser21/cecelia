# devloop-check 单一 exit 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 devloop-check.sh 的 harness 快速退出路径，让 harness 与非 harness 统一收敛到唯一 exit 0 = PR merged。

**Architecture:** 4 处外科手术式修改 `packages/engine/lib/devloop-check.sh`：条件 0.5 删除 `_mark_cleanup_done + return 0`；条件 2.6 加 harness 跳过守卫；条件 5 和 6 加 harness 跳过 step_4_ship 检查。新增 1 个测试文件验证行为，更新 Engine 版本（5 文件）。

**Tech Stack:** Bash, TypeScript (vitest), Engine version bump

---

### Task 1: 写失败测试（TDD 红灯）

**Files:**
- Create: `packages/engine/tests/scripts/devloop-check-harness-single-exit.test.ts`

TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。这不是 prototype。

- [ ] **Step 1: 创建测试文件**

```bash
cat > packages/engine/tests/scripts/devloop-check-harness-single-exit.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — harness 单一 exit 0 收敛（v4.6.0）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  it('harness 快速通道内不含 _mark_cleanup_done（PR 创建后不立即退出）', () => {
    const cond05Idx = content.indexOf('===== 条件 0.5');
    const cond1Idx = content.indexOf('===== 条件 1');
    expect(cond05Idx).toBeGreaterThan(-1);
    expect(cond1Idx).toBeGreaterThan(-1);
    const harnessSection = content.substring(cond05Idx, cond1Idx);
    expect(harnessSection).not.toContain('_mark_cleanup_done');
  });

  it('harness 快速通道内不含 return 0（不在 PR 创建时提前退出）', () => {
    const cond05Idx = content.indexOf('===== 条件 0.5');
    const cond1Idx = content.indexOf('===== 条件 1');
    const harnessSection = content.substring(cond05Idx, cond1Idx);
    expect(harnessSection).not.toMatch(/\breturn 0\b/);
  });

  it('条件 2.6 DoD 检查有 _harness_mode 跳过守卫', () => {
    const cond26Idx = content.indexOf('===== 条件 2.6');
    const cond3Idx = content.indexOf('===== 条件 3');
    expect(cond26Idx).toBeGreaterThan(-1);
    const section = content.substring(cond26Idx, cond3Idx);
    expect(section).toContain('_harness_mode');
  });

  it('条件 5（PR merged）有 harness_mode 跳过 step_4_ship 的逻辑', () => {
    const cond5Idx = content.indexOf('===== 条件 5');
    const cond6Idx = content.indexOf('===== 条件 6');
    expect(cond5Idx).toBeGreaterThan(-1);
    const section = content.substring(cond5Idx, cond6Idx);
    expect(section).toContain('_harness_mode');
  });

  it('条件 6（CI 通过→merge）有 harness_mode 跳过 step_4_ship 的逻辑', () => {
    const cond6Idx = content.indexOf('===== 条件 6');
    expect(cond6Idx).toBeGreaterThan(-1);
    const section = content.substring(cond6Idx, cond6Idx + 1500);
    expect(section).toContain('_harness_mode');
  });
});
EOF
```

- [ ] **Step 2: 运行测试，确认全部失败**

```bash
cd packages/engine && npx vitest run tests/scripts/devloop-check-harness-single-exit.test.ts 2>&1 | tail -15
```

预期：5 个 FAIL（当前 devloop-check.sh 没有 harness 跳过逻辑）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/engine/tests/scripts/devloop-check-harness-single-exit.test.ts
git commit -m "test(engine): devloop-check harness 单一 exit 0 行为测试（TDD 红灯）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现四处改动

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`

- [ ] **Step 1: 改动 1 — 条件 0.5 删除 `_mark_cleanup_done + return 0`**

找到以下代码块（约第 176-182 行）：

```bash
        # Harness 模式: 代码写完 + PR 已创建 → 开启 auto-merge → done
        gh pr merge "$_h_pr" --squash --auto 2>/dev/null || true
        _mark_cleanup_done "$dev_mode_file"
        _devloop_jq -n --arg pr "$_h_pr" \
            '{"status":"done","reason":"[Harness] 代码完成 + PR #\($pr) 已创建（auto-merge 已开启），session 结束，Brain 将派 Evaluator 验证"}'
        return 0
    fi
```

替换为：

```bash
        # Harness 模式: 代码写完 + PR 已创建 → 开启 auto-merge，继续等待 CI + merge
        # 单一 exit 0 原则：不提前退出，继续走条件 4（CI 等待）→ 条件 6（自动 merge）
        gh pr merge "$_h_pr" --squash --auto 2>/dev/null || true
    fi
```

同时更新文件顶部 changelog 注释（约第 8-9 行），在现有 `# 更新:` 行后追加：

```bash
# 更新: 2026-05-02 — v4.6.0 单一 exit 0：删除 harness 快速通道 return 0，harness 统一走 CI 等待 + auto-merge
```

- [ ] **Step 2: 改动 2 — 条件 2.6 加 harness 跳过守卫**

找到（约第 205 行）：

```bash
    # ===== 条件 2.6: DoD 完整性检查 =====
    if [[ -f "$dev_mode_file" ]]; then
```

替换为：

```bash
    # ===== 条件 2.6: DoD 完整性检查 =====
    # harness 模式跳过 DoD 检查（harness 任务不要求填写 DoD）
    if [[ "$_harness_mode" != "true" ]] && [[ -f "$dev_mode_file" ]]; then
```

- [ ] **Step 3: 改动 3 — 条件 5 加 harness 跳过 step_4_ship**

找到（约第 305-310 行）：

```bash
        if [[ "$step_4_status" == "done" ]]; then
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n '{"status":"done","reason":"Stage 4 Ship 已完成，cleanup_done 已标记，工作流结束"}'
            return 0
```

替换为：

```bash
        if [[ "$step_4_status" == "done" ]] || [[ "$_harness_mode" == "true" ]]; then
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n '{"status":"done","reason":"PR 已合并，工作流结束"}'
            return 0
```

- [ ] **Step 4: 改动 4 — 条件 6 加 harness 跳过 step_4_ship**

找到（约第 340-344 行）：

```bash
    if [[ "$step_4_status" != "done" ]]; then
        _devloop_jq -n --arg pr "$pr_number" \
            '{"status":"blocked","reason":"CI 通过，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4，写 Learning + 合并 PR #\($pr)。禁止询问用户。"}'
        return 2
    fi
```

替换为：

```bash
    # harness 模式跳过 step_4_ship 要求（harness 任务不写 Learning）
    if [[ "$_harness_mode" != "true" ]] && [[ "$step_4_status" != "done" ]]; then
        _devloop_jq -n --arg pr "$pr_number" \
            '{"status":"blocked","reason":"CI 通过，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4，写 Learning + 合并 PR #\($pr)。禁止询问用户。"}'
        return 2
    fi
```

- [ ] **Step 5: 运行测试，确认全部通过**

```bash
cd packages/engine && npx vitest run tests/scripts/devloop-check-harness-single-exit.test.ts 2>&1 | tail -10
```

预期：`5 passed`

- [ ] **Step 6: 运行全量 engine 测试，确认无回归**

```bash
cd packages/engine && npx vitest run 2>&1 | tail -10
```

预期：所有测试通过，pass 数与改动前持平或更多

- [ ] **Step 7: 提交实现**

```bash
git add packages/engine/lib/devloop-check.sh
git commit -m "fix(engine): [CONFIG] devloop-check v4.6.0 — 单一 exit 0，harness 统一收敛到 PR merged

删除 harness 快速通道（条件 0.5）的 _mark_cleanup_done + return 0。
harness 现在走完整 CI 等待 + auto-merge 路径，与非 harness 唯一 exit 0 一致。

四处改动：
- 条件 0.5: 删除 PR 创建后的 done 退出，保留 auto-merge 开启
- 条件 2.6: harness 跳过 DoD 完整性检查
- 条件 5: harness 跳过 step_4_ship=done 要求
- 条件 6: harness 跳过 step_4_ship=done 检查

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Engine 版本 bump

**Files:**
- Modify: `packages/engine/package.json` — version 字段
- Modify: `packages/engine/package-lock.json` — 两处 version 字段
- Modify: `packages/engine/VERSION` — 版本号文件
- Modify: `packages/engine/hooks/.hook-core-version` — hook 版本
- Modify: `packages/engine/skills/dev/regression-contract.yaml` — contract version

- [ ] **Step 1: 读取当前版本**

```bash
cat packages/engine/VERSION
```

记下当前版本（如 `5.0.7`），新版本为 patch bump（如 `5.0.8`）。

- [ ] **Step 2: 更新 5 个版本文件**

以当前版本 `OLD_VER` 为准，执行（替换 `OLD_VER` 和 `NEW_VER`）：

```bash
OLD_VER=$(cat packages/engine/VERSION)
NEW_VER=$(echo "$OLD_VER" | awk -F. '{print $1"."$2"."$3+1}')
echo "bump: $OLD_VER → $NEW_VER"

# 1. VERSION 文件
echo "$NEW_VER" > packages/engine/VERSION

# 2. package.json
sed -i '' "s/\"version\": \"$OLD_VER\"/\"version\": \"$NEW_VER\"/" packages/engine/package.json

# 3. package-lock.json（两处）
sed -i '' "s/\"version\": \"$OLD_VER\"/\"version\": \"$NEW_VER\"/g" packages/engine/package-lock.json

# 4. .hook-core-version
echo "$NEW_VER" > packages/engine/hooks/.hook-core-version

# 5. regression-contract.yaml
sed -i '' "s/engine_version: \"$OLD_VER\"/engine_version: \"$NEW_VER\"/" packages/engine/skills/dev/regression-contract.yaml
```

- [ ] **Step 3: 验证 5 个文件都已更新**

```bash
grep -r "\"$NEW_VER\"\|^$NEW_VER" \
  packages/engine/VERSION \
  packages/engine/package.json \
  packages/engine/package-lock.json \
  packages/engine/hooks/.hook-core-version \
  packages/engine/skills/dev/regression-contract.yaml
```

预期：每个文件各出现至少 1 次新版本号

- [ ] **Step 4: 更新 feature-registry.yml 并生成 path views**

```bash
# 在 feature-registry.yml 的 changelog 数组开头追加新条目
# 找到 changelog: 行，在其后插入
node -e "
const fs = require('fs');
const f = 'packages/engine/skills/dev/feature-registry.yml';
let c = fs.readFileSync(f, 'utf8');
const date = new Date().toISOString().split('T')[0];
const entry = '  - version: \"' + process.env.NEW_VER + '\"\n    date: \"' + date + '\"\n    change: \"devloop-check v4.6.0: 单一 exit 0，harness 统一收敛到 PR merged\"\n';
c = c.replace('changelog:\n', 'changelog:\n' + entry);
fs.writeFileSync(f, c);
console.log('feature-registry.yml updated');
" NEW_VER="$NEW_VER"

bash packages/engine/scripts/generate-path-views.sh
```

- [ ] **Step 5: 提交版本 bump**

```bash
git add \
  packages/engine/VERSION \
  packages/engine/package.json \
  packages/engine/package-lock.json \
  packages/engine/hooks/.hook-core-version \
  packages/engine/skills/dev/regression-contract.yaml \
  packages/engine/skills/dev/feature-registry.yml \
  packages/engine/skills/dev/

git commit -m "chore(engine): [CONFIG] version bump $OLD_VER → $NEW_VER（devloop-check 单一 exit 0）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
