# Harness propose_branch 协议 Mismatch 双修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 SKILL Step 4 verdict JSON 输出限定 + Graph fallback 格式 mismatch 双重 bug，让 W8 acceptance 14 节点能推过 inferTaskPlan。

**Architecture:** SKILL 层让 proposer 每轮（含被打回轮）都输出 verdict JSON（含 `propose_branch`）；Graph 层让 fallback 跟 SKILL 实际 push 格式一致（`cp-harness-propose-r{round}-{taskIdSlice}`）。双层防护，任一处工作 graph 都拿对分支。

**Tech Stack:** Node.js (Brain) + Vitest (unit) + Bash (smoke) + Markdown SKILL DSL

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js` | **新建** | 5 个 unit test 覆盖 extractProposeBranch + fallbackProposeBranch 两个纯函数 |
| `packages/brain/src/workflows/harness-gan.graph.js` | **改** | line 182-189 改 fallback 签名+格式；line 393 调用点传 round |
| `packages/workflows/skills/harness-contract-proposer/SKILL.md` | **改** | line 314 删 "GAN APPROVED 后" 限定 + 加输出契约段 + frontmatter version bump 7.1.0→7.2.0 + changelog |
| `packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh` | **新建** | 真环境验证脚本：node 调 fallback 跑 4 个 case |
| `packages/brain/package.json` | **改** | version 1.228.3 → 1.228.4 |
| `packages/brain/package-lock.json` | **改** | 同步 brain 版本号 |
| `docs/learnings/cp-0508082901-harness-propose-branch-protocol-fix.md` | **新建** | Learning 文件（含「根本原因」+「下次预防」）|

---

## Task 1: TDD Red — 写 unit test (extract + fallback) + smoke.sh 骨架

**Files:**
- Create: `packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js`
- Create: `packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh`

- [ ] **Step 1.1: 写 failing unit test 文件**

```javascript
// packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js
import { describe, it, expect } from 'vitest';
import { extractProposeBranch, fallbackProposeBranch } from '../harness-gan.graph.js';

describe('extractProposeBranch [BEHAVIOR]', () => {
  it('命中 SKILL Step 4 模板的 verdict JSON', () => {
    const stdout = '...some logs...\n{"verdict": "PROPOSED", "contract_draft_path": "x", "propose_branch": "cp-harness-propose-r2-49dafaf4", "workstream_count": 1, "test_files_count": 1, "task_plan_path": "y"}\n';
    expect(extractProposeBranch(stdout)).toBe('cp-harness-propose-r2-49dafaf4');
  });

  it('stdout 无 JSON 时返回 null', () => {
    expect(extractProposeBranch('just some logs without json\n')).toBeNull();
    expect(extractProposeBranch('')).toBeNull();
    expect(extractProposeBranch(null)).toBeNull();
  });
});

describe('fallbackProposeBranch [BEHAVIOR]', () => {
  it('返回 cp-harness-propose-r{round}-{taskIdSlice} 格式', () => {
    expect(fallbackProposeBranch('49dafaf4-1d84-4da4-b4a8-4f5b9c56facf', 2)).toBe('cp-harness-propose-r2-49dafaf4');
  });

  it('round 为 undefined / 0 / 负数 时默认 round=1', () => {
    const taskId = '49dafaf4-1d84-4da4-b4a8-4f5b9c56facf';
    expect(fallbackProposeBranch(taskId)).toBe('cp-harness-propose-r1-49dafaf4');
    expect(fallbackProposeBranch(taskId, 0)).toBe('cp-harness-propose-r1-49dafaf4');
    expect(fallbackProposeBranch(taskId, -1)).toBe('cp-harness-propose-r1-49dafaf4');
  });

  it('null / undefined taskId 返回 cp-harness-propose-r{round}-unknown', () => {
    expect(fallbackProposeBranch(null, 3)).toBe('cp-harness-propose-r3-unknown');
    expect(fallbackProposeBranch(undefined, 1)).toBe('cp-harness-propose-r1-unknown');
  });

  it('短 taskId（<8字符）原样使用，不补零', () => {
    expect(fallbackProposeBranch('abc', 1)).toBe('cp-harness-propose-r1-abc');
  });
});
```

- [ ] **Step 1.2: 写 smoke.sh 骨架（先 fail）**

```bash
#!/usr/bin/env bash
# packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh
# 真环境验证：propose_branch 协议 fallback 函数命中实际 SKILL push 格式
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BRAIN_ROOT"

# Case 1: extractProposeBranch 命中 SKILL JSON 输出
RESULT=$(node -e "
  import('./src/workflows/harness-gan.graph.js').then(m => {
    const out = m.extractProposeBranch('logs\n{\"verdict\":\"PROPOSED\",\"propose_branch\":\"cp-harness-propose-r1-deadbeef\"}\n');
    console.log(out);
  });
")
if [ "$RESULT" != "cp-harness-propose-r1-deadbeef" ]; then
  echo "FAIL: extractProposeBranch 期待 cp-harness-propose-r1-deadbeef 实得 $RESULT"
  exit 1
fi

# Case 2: fallbackProposeBranch 跟 SKILL Step 4 push 格式 cp-harness-propose-r{N}-{taskIdSlice} 一致
RESULT=$(node -e "
  import('./src/workflows/harness-gan.graph.js').then(m => {
    const out = m.fallbackProposeBranch('49dafaf4-1d84-4da4-b4a8-4f5b9c56facf', 2);
    console.log(out);
  });
")
if [ "$RESULT" != "cp-harness-propose-r2-49dafaf4" ]; then
  echo "FAIL: fallbackProposeBranch 期待 cp-harness-propose-r2-49dafaf4 实得 $RESULT"
  exit 1
fi

# Case 3: SKILL.md 文件含 propose_branch JSON 输出 + 不含限定词 "GAN APPROVED 后"
SKILL_PATH="$BRAIN_ROOT/../workflows/skills/harness-contract-proposer/SKILL.md"
node -e "
  const c = require('fs').readFileSync('$SKILL_PATH', 'utf8');
  if (!c.includes('\"propose_branch\"')) { console.error('FAIL: SKILL.md 缺 propose_branch 输出契约'); process.exit(1); }
  if (c.includes('GAN APPROVED 后')) { console.error('FAIL: SKILL.md 仍含限定词 GAN APPROVED 后'); process.exit(2); }
"

echo "✅ propose-branch-protocol smoke PASS (3/3 cases)"
```

- [ ] **Step 1.3: chmod +x smoke.sh**

```bash
chmod +x packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh
```

- [ ] **Step 1.4: 跑 unit test 验证全 fail（Red 证据）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
cd packages/brain && npx vitest run src/workflows/__tests__/extract-and-fallback-propose-branch.test.js --reporter=verbose 2>&1 | tail -30
```

期望：`fallbackProposeBranch` 4 个 test 全 FAIL（当前实现返回 `cp-MMDDHHmm-XXX` 而非 `cp-harness-propose-rN-XXX`）；`extractProposeBranch` 2 个可能通过（SKILL 模板格式不变）也可能 fail（取决于 stdout 解析行为）。**至少 fallbackProposeBranch 全 4 fail 即足证 Red**。

- [ ] **Step 1.5: 跑 smoke.sh 验证 fail（fallback 因为旧格式失败 + SKILL 因为还含限定词失败）**

```bash
bash packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh
echo "exit=$?"
```

期望：exit ≠ 0，因为 fallback 旧格式 mismatch + SKILL.md 还含 "GAN APPROVED 后" 限定词。

- [ ] **Step 1.6: Commit (TDD Red)**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
git add packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js \
        packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh
git commit -m "test(brain): TDD Red — extract+fallback propose_branch unit + smoke 骨架"
```

---

## Task 2: TDD Green — impl Graph fallback 改格式

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js` (line 182-189 + line 393)

- [ ] **Step 2.1: 改 fallbackProposeBranch 函数（line 182-189）**

把当前实现：
```javascript
export function fallbackProposeBranch(taskId, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {});
  const stamp = `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
  return `cp-${stamp}-${String(taskId || 'unknown').slice(0, 8)}`;
}
```

改成：
```javascript
// fallback：SKILL Step 4 实际 push 格式 cp-harness-propose-r{round}-{taskIdSlice}。
// 跟 SKILL push 一致，即使 stdout 漏 JSON 也能命中真实分支。
export function fallbackProposeBranch(taskId, round) {
  const taskSlice = String(taskId || 'unknown').slice(0, 8);
  const r = Number.isInteger(round) && round >= 1 ? round : 1;
  return `cp-harness-propose-r${r}-${taskSlice}`;
}
```

更新顶部注释（line 180-181）：
```javascript
// 用于 propose_branch 抽取失败时的 fallback：cp-harness-propose-r{round}-<taskIdSlice>。
// 跟 SKILL Step 4 实际 push 格式一致，即使 stdout 没 JSON 也能命中真实分支。
```

- [ ] **Step 2.2: 改调用点（line 393）传 nextRound**

```javascript
// 旧
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);
// 新
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId, nextRound);
```

- [ ] **Step 2.3: grep 确认没有别处用旧签名调 fallbackProposeBranch**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
grep -rn "fallbackProposeBranch" packages/brain/src/ packages/brain/__tests__ packages/brain/tests 2>&1 | grep -v "__tests__/extract-and-fallback"
```

期望：只剩 `harness-gan.graph.js` 自己的定义 + line 393 调用点。如果有别处调用，按新签名同步改。

- [ ] **Step 2.4: 跑 unit test 验证全绿（Green 证据）**

```bash
cd packages/brain && npx vitest run src/workflows/__tests__/extract-and-fallback-propose-branch.test.js --reporter=verbose 2>&1 | tail -15
```

期望：6 个 test 全 PASS（4 fallback + 2 extract）。

- [ ] **Step 2.5: Commit (TDD Green for Graph)**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "$(cat <<'EOF'
fix(brain): fallbackProposeBranch 改用 SKILL push 格式 cp-harness-propose-r{round}-{taskIdSlice}

旧 fallback 生成 cp-MMDDHHmm-{taskIdSlice} 跟 SKILL Step 4 实际
push 的 cp-harness-propose-r{N}-{taskIdSlice} 格式不一致 → graph
state.proposeBranch 拿到错的分支名 → inferTaskPlan git show 失败
→ harness graph failed。

W8 task 49dafaf4 实证：origin 上有 cp-harness-propose-r2-49dafaf4
但 graph 找 cp-05080823-49dafaf4 找不到。

改成同格式后即使 SKILL stdout 漏 JSON 也能命中真实分支。
EOF
)"
```

---

## Task 3: TDD Red — 写 SKILL.md behavior test

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js`（追加 SKILL lint 段）

- [ ] **Step 3.1: 在 unit test 文件末尾追加 SKILL.md lint test**

在已有 describe 后追加：
```javascript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('SKILL.md lint [BEHAVIOR]', () => {
  const SKILL_PATH = resolve(import.meta.dirname, '../../../../workflows/skills/harness-contract-proposer/SKILL.md');

  it('SKILL.md 含 propose_branch verdict JSON 输出契约', () => {
    const c = readFileSync(SKILL_PATH, 'utf8');
    expect(c).toContain('"propose_branch"');
  });

  it('SKILL.md 不含 verdict JSON 限定词 "GAN APPROVED 后"', () => {
    const c = readFileSync(SKILL_PATH, 'utf8');
    expect(c).not.toContain('GAN APPROVED 后');
  });

  it('SKILL.md 含明示「每轮」输出契约说明', () => {
    const c = readFileSync(SKILL_PATH, 'utf8');
    expect(c).toMatch(/每轮.*verdict|每轮.*propose_branch|每轮.*JSON/);
  });
});
```

- [ ] **Step 3.2: 跑 unit test 验证 lint 段 fail**

```bash
cd packages/brain && npx vitest run src/workflows/__tests__/extract-and-fallback-propose-branch.test.js --reporter=verbose 2>&1 | tail -20
```

期望：之前 6 个 PASS + 新 3 个 lint test 至少 2 fail（"GAN APPROVED 后" 还在 + 缺"每轮"明示）。

- [ ] **Step 3.3: Commit (TDD Red for SKILL lint)**

```bash
git add packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js
git commit -m "test(brain): TDD Red — SKILL.md propose_branch verdict 输出契约 lint"
```

---

## Task 4: TDD Green — 改 SKILL.md Step 4 verdict 输出条件 + version bump

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

- [ ] **Step 4.1: 改 frontmatter version + changelog（line 7-15）**

旧：
```yaml
version: 7.1.0
created: 2026-04-08
updated: 2026-05-07
changelog:
  - 7.1.0: 修复 task-plan.json 永不生成 (#2819) — Step 3 改成每轮都生成（删 "仅 APPROVED 时执行" 门槛）；APPROVED 分支即最后一轮 proposer 的分支，inferTaskPlan 从此读取
  - 7.0.0: ...
```

改：
```yaml
version: 7.2.0
created: 2026-04-08
updated: 2026-05-08
changelog:
  - 7.2.0: 修 verdict JSON 输出限定 — Step 4 删 "GAN APPROVED 后" 限定词，改成"每轮（含被 REVISION 打回轮）"；新增"输出契约"段明示 brain harness-gan.graph.js extractProposeBranch 用正则解析。配合 brain fallback 改格式，杜绝 propose_branch 协议 mismatch（W8 task 49dafaf4 实证）
  - 7.1.0: 修复 task-plan.json 永不生成 (#2819) — Step 3 改成每轮都生成（删 "仅 APPROVED 时执行" 门槛）；APPROVED 分支即最后一轮 proposer 的分支，inferTaskPlan 从此读取
  - 7.0.0: ...
```

- [ ] **Step 4.2: 改 Step 4 line 314 + 加输出契约段**

旧：
```
**最后一条消息**（GAN APPROVED 后）：

​```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r1-xxxxxxxx", "workstream_count": N, "test_files_count": M, "task_plan_path": "${SPRINT_DIR}/task-plan.json"}
​```
```

改成：
```
**最后一条消息**（每轮 — 含被 REVISION 打回轮）：

​```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}", "workstream_count": N, "test_files_count": M, "task_plan_path": "${SPRINT_DIR}/task-plan.json"}
​```

**输出契约**（v7.2.0+ 强约束 — 漏写 brain 走 fallback 可能走错路）：

每轮 proposer 调用结束时 stdout **必须含且仅含一行 JSON 字面量**含 `verdict` + `propose_branch` 字段，brain 端 `harness-gan.graph.js` 的 `extractProposeBranch` 用正则 `/"propose_branch"\s*:\s*"([^"]+)"/` 解析。即使本轮被 Reviewer REVISION 打回也必须输出（brain 把每轮 propose_branch 都存下来用，不仅最后一轮）。

漏写后果：brain 走 `fallbackProposeBranch(taskId, round)` 兜底，虽然 v7.2.0 起 fallback 也用 `cp-harness-propose-r{round}-{taskIdSlice}` 格式（跟 SKILL push 一致），但万一 SKILL 实际 push 时 TASK_ID_SHORT 跟 brain taskId.slice(0,8) 不一致（如 LLM 取 slice 算法不同），brain 仍可能找不到分支。**SKILL 自己输出 verdict JSON 是首选**。
```

- [ ] **Step 4.3: 跑 unit test 验证 lint 转绿**

```bash
cd packages/brain && npx vitest run src/workflows/__tests__/extract-and-fallback-propose-branch.test.js --reporter=verbose 2>&1 | tail -25
```

期望：所有 9 个 test (6 函数 + 3 lint) 全 PASS。

- [ ] **Step 4.4: Commit (TDD Green for SKILL)**

```bash
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "$(cat <<'EOF'
feat(workflows): SKILL.md harness-contract-proposer v7.2.0 — verdict JSON 每轮输出契约

Step 4 line 314 删 "GAN APPROVED 后" 限定，改成 "每轮（含被 REVISION
打回轮）"。新增"输出契约"段明示 brain extractProposeBranch 解析方
式，杜绝 LLM 按字面理解 r1/r2 不输出 JSON 的隐患。

配合 brain fallbackProposeBranch 改用同格式 (cp-harness-propose-
r{round}-{taskIdSlice})，双层防护。

W8 task 49dafaf4 实证根因。
EOF
)"
```

---

## Task 5: smoke.sh 真环境验证 + brain version bump

**Files:**
- Modify: `packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh`（确认能跑）
- Modify: `packages/brain/package.json` (version bump)
- Modify: `packages/brain/package-lock.json` (sync)

- [ ] **Step 5.1: 跑 smoke.sh 验证转绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
bash packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh
echo "exit=$?"
```

期望：`✅ propose-branch-protocol smoke PASS (3/3 cases)` + exit 0。

- [ ] **Step 5.2: 改 packages/brain/package.json version 1.228.3 → 1.228.4**

用 npm version 或手改。手改更精确：
```bash
node -e "
const fs = require('fs');
const path = 'packages/brain/package.json';
const p = JSON.parse(fs.readFileSync(path, 'utf8'));
p.version = '1.228.4';
fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\n');
console.log('bumped to', p.version);
"
```

- [ ] **Step 5.3: 同步 package-lock.json version**

```bash
node -e "
const fs = require('fs');
const path = 'packages/brain/package-lock.json';
const lock = JSON.parse(fs.readFileSync(path, 'utf8'));
lock.version = '1.228.4';
if (lock.packages && lock.packages['']) lock.packages[''].version = '1.228.4';
fs.writeFileSync(path, JSON.stringify(lock, null, 2) + '\n');
console.log('lock bumped to', lock.version);
"
```

- [ ] **Step 5.4: 验证两处 version 一致**

```bash
grep '"version"' packages/brain/package.json | head -1
grep '"version"' packages/brain/package-lock.json | head -2
```

期望：都是 `"version": "1.228.4"`。

- [ ] **Step 5.5: Commit (version bump)**

```bash
git add packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): bump version 1.228.3 → 1.228.4 — propose_branch 协议双修"
```

---

## Task 6: Learning 文件 + PRD 双放置

**Files:**
- Create: `docs/learnings/cp-0508082901-harness-propose-branch-protocol-fix.md`
- Create: `packages/workflows/2026-05-08-harness-propose-branch-protocol-fix-prd.md`（PRD 双放置规则）

- [ ] **Step 6.1: 写 Learning 文件**

```markdown
# cp-0508082901 — Harness propose_branch 协议 mismatch 双修

**日期**: 2026-05-08
**Branch**: cp-0508082901-harness-propose-branch-protocol-fix
**触发**: W8 acceptance task 49dafaf4 fail at inferTaskPlan

## 现象

W8 14 节点 acceptance 跑到 inferTaskPlan 报：
`fatal: invalid object name 'origin/cp-05080823-49dafaf4'`

但 origin 上实际有 `cp-harness-propose-r1-49dafaf4` + `cp-harness-propose-r2-49dafaf4`。

## 根本原因

两层 bug 叠加：

1. **SKILL 文档 bug**：`packages/workflows/skills/harness-contract-proposer/SKILL.md` Step 4 line 314 把 verdict JSON 输出限定在"**GAN APPROVED 后**"。LLM 按字面理解，r1/r2 没 APPROVED 时不输出 JSON。但 brain `harness-gan.graph.js` 每轮调用 proposer 后立刻 `extractProposeBranch(stdout)` → 解析失败 → 走 fallback。

2. **Graph fallback bug**：`fallbackProposeBranch` 生成 `cp-MMDDHHmm-{taskIdSlice}` 格式，跟 SKILL Step 4 实际 push 的 `cp-harness-propose-r{N}-{taskIdSlice}` **完全不一致**。任何走 fallback 的 case 都拿到不存在的分支名，inferTaskPlan 拿不到 task-plan.json 硬 fail（PR #2820 加的"硬 fail 不静默"逻辑生效）。

PR #2820 修了"proposer 每轮写 task-plan.json"+"inferTaskPlan 硬 fail"，但**没修 SKILL stdout 输出 verdict JSON 的限定词，也没修 fallback 格式**——所以 task-plan.json 写在 propose r2 分支上，graph 却找 fallback 名分支，命中失败。

## 下次预防

- [ ] **协议契约成对改**：任何"SKILL 输出格式 ↔ brain 解析约定"的协议变更必须 SKILL 端 + brain 端 + fallback 一并改，避免单边改造成隐患
- [ ] **Fallback 必须跟主路径同格式**：fallback 是兜底不是另一种实现，不能跟主路径的命名/格式不一致
- [ ] **SKILL DSL 写"GAN APPROVED 后"等条件限定时务必想清楚 LLM 按字面理解会怎样**：LLM 不会推理"虽然限定 APPROVED 但 brain 每轮都需要"
- [ ] **新协议字段必须有 lint test**（SKILL.md grep 输出契约 + brain regex 命中样例），双向闭环

## 修复方案

- SKILL Step 4 删 "GAN APPROVED 后" 改 "每轮（含被 REVISION 打回轮）"，加"输出契约"段
- Graph fallback 改用 `cp-harness-propose-r{round}-{taskIdSlice}` 跟 SKILL push 同格式
- 加 9 个 unit test 覆盖 extract + fallback + SKILL lint
- 加 smoke.sh 真环境验证
```

写入 `docs/learnings/cp-0508082901-harness-propose-branch-protocol-fix.md`。

- [ ] **Step 6.2: 写 PRD 双放置文件**

按 memory `packages/workflows/ PRD/DoD 放置` 规则，把 raw PRD 复制一份到 `packages/workflows/`：

```bash
cp .raw-prd-cp-0508082901-harness-propose-branch-protocol-fix.md \
   packages/workflows/2026-05-08-harness-propose-branch-protocol-fix-prd.md
```

- [ ] **Step 6.3: Commit (Learning + PRD)**

```bash
git add docs/learnings/cp-0508082901-harness-propose-branch-protocol-fix.md \
        packages/workflows/2026-05-08-harness-propose-branch-protocol-fix-prd.md
git commit -m "docs(harness): learning + PRD 双放置 — propose_branch 协议双修"
```

---

## Task 7: 终验 + push + PR

- [ ] **Step 7.1: 跑全部 unit test 一次**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
cd packages/brain && npx vitest run src/workflows/__tests__/extract-and-fallback-propose-branch.test.js --reporter=verbose 2>&1 | tail -20
```

期望：9/9 PASS。

- [ ] **Step 7.2: 跑 smoke.sh 一次**

```bash
cd /Users/administrator/worktrees/cecelia/harness-propose-branch-protocol-fix
bash packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh
echo "exit=$?"
```

期望：exit 0。

- [ ] **Step 7.3: git log 看 commit 顺序符合 TDD**

```bash
git log --oneline main..HEAD
```

期望顺序（自下而上）：
1. spec doc commit (`f200a819a` 已有)
2. test(brain): TDD Red — extract+fallback unit + smoke 骨架
3. fix(brain): fallbackProposeBranch 改 SKILL push 格式
4. test(brain): TDD Red — SKILL.md lint
5. feat(workflows): SKILL.md v7.2.0 verdict JSON 每轮
6. chore(brain): bump version 1.228.3 → 1.228.4
7. docs(harness): learning + PRD 双放置

- [ ] **Step 7.4: 推到 origin**

```bash
git push origin cp-0508082901-harness-propose-branch-protocol-fix
```

- [ ] **Step 7.5: 开 PR（按 superpowers:finishing-a-development-branch Option 2）**

由 finishing skill 接管，body 含 W8 实证背景 + 双修方案 + 验证证据。

---

## Self-Review

✅ **Spec coverage**: spec 6 个改动清单全有对应 task（test 文件 / graph / SKILL / smoke / version / learning）
✅ **Placeholder scan**: 无 TBD/TODO；所有代码块含完整代码
✅ **Type consistency**: `fallbackProposeBranch(taskId, round)` 签名在 Task 1 test、Task 2 impl、Task 5 smoke 一致；`extractProposeBranch` 签名不变
✅ **TDD 顺序**: Task 1/3 都是 commit-1 (Red) → Task 2/4 都是 commit-2 (Green)，subagent-driven 执行时 controller 会 verify
✅ **CI 兼容**: smoke.sh 用 `node -e` + `bash`（白名单内），SKILL lint test 用 `vitest`（不在白名单但是测试文件内调用，CI 会跑）

---

## Execution Handoff

按 dev SKILL Tier 1 默认: **Subagent-Driven**（recommended）。下一步 invoke `superpowers:subagent-driven-development`。

每个 implementer subagent prompt 必须 inline TDD iron law 4 条：
1. NO PRODUCTION CODE WITHOUT FAILING TEST FIRST
2. Throwaway prototype 才 skip — 你不是 prototype
3. 每 plan task 必须 git commit 顺序：commit-1 fail test / commit-2 impl
4. controller 会 verify commit 顺序，不符合让你重做
