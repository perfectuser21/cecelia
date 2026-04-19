# Phase 6 e2e Proof Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `docs/proofs/phase6-e2e/MARKER.md` 新建一个 Markdown 文件，完成一次 cp-* 分支 → PR → 自动合并的完整闭环，作为 Phase 6 e2e 接力链跑通的证据。

**Architecture:** 单文件新增，无代码变动，无测试。通过 /dev 9 棒接力链（worktree → brainstorming → writing-plans → subagent-driven → verification → finishing → engine-ship → Stop Hook）完成 PR 自动合并。

**Tech Stack:** Markdown only.

---

## 文件结构

- Create: `docs/proofs/phase6-e2e/MARKER.md` — Phase 6 e2e proof 文件
- 已存在（spec/plan 本身，前置已 commit）：
  - `docs/superpowers/specs/2026-04-19-phase6-e2e-proof-design.md`
  - `docs/superpowers/plans/2026-04-19-phase6-e2e-proof.md`（本文件）

---

### Task 1: 创建 Phase 6 e2e proof marker 文件

**Files:**
- Create: `docs/proofs/phase6-e2e/MARKER.md`

- [ ] **Step 1: 新建目录 + 写入文件**

在 worktree 根 `/Users/administrator/worktrees/cecelia/phase6-e2e-proof/` 下创建 `docs/proofs/phase6-e2e/MARKER.md`，内容：

```markdown
# Phase 6 e2e proof

Phase 6 e2e chain verified on 2026-04-19.

Branch: `cp-0419194759-phase6-e2e-proof`
Chain: engine-worktree → brainstorming → writing-plans → subagent-driven-development → verification-before-completion → finishing → engine-ship → Stop Hook auto-merge.
```

- [ ] **Step 2: 验证文件内容满足 DoD**

Run:
```bash
test -f /Users/administrator/worktrees/cecelia/phase6-e2e-proof/docs/proofs/phase6-e2e/MARKER.md \
  && grep -q '^# Phase 6 e2e proof$' /Users/administrator/worktrees/cecelia/phase6-e2e-proof/docs/proofs/phase6-e2e/MARKER.md \
  && grep -qE '2026-[0-9]{2}-[0-9]{2}' /Users/administrator/worktrees/cecelia/phase6-e2e-proof/docs/proofs/phase6-e2e/MARKER.md \
  && echo OK
```

Expected: `OK`（文件存在 + 首行 `# Phase 6 e2e proof` + 含 ISO 日期）

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/phase6-e2e-proof
git add docs/proofs/phase6-e2e/MARKER.md
git commit -m "docs: add phase6 e2e proof marker"
```

Expected: 1 file changed, 至少 3 insertions。

---

## DoD 对齐

| PRD 成功标准 | 本 Plan 覆盖点 |
|---|---|
| 1. `docs/proofs/phase6-e2e/MARKER.md` 存在于 main | Task 1 Step 1（文件）+ Stop Hook 合并 |
| 2. 两行：`# Phase 6 e2e proof` + ISO 日期正文 | Task 1 Step 1 内容 + Step 2 验证 |
| 3. PR 标题 `docs: add phase6 e2e proof marker` | Task 1 Step 3 commit message（finishing 会用它作 PR title） |
| 4. PR 通过 CI 自动合并 | engine-ship + Stop Hook（plan 外步骤） |
| 5. 工作树 cleanup | Stop Hook（plan 外步骤） |

## 不做

- 不改 `packages/`、`apps/`、`scripts/`
- 不改 feature-registry / regression-contract / VERSION / CI workflow / changelog
- 不写单元测试（非 `feat:`，不触发 L3）

## 风险

本 Plan 本身风险极低。Stop Hook 合并路径已在 Phase 5/6 验证；`docs-only` 改动不触发 Engine CI、DoD gate、L3 test-required。
