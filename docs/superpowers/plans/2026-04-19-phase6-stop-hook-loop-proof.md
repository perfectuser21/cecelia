# Phase 6 Stop Hook Loop Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个 2 行的 marker 文件 `docs/proofs/phase6-e2e/MARKER2.md`，端到端验证 /dev 接力链 + Stop Hook 自动合并循环。

**Architecture:** 单文件 docs-only 变更。无代码、无 CI、无测试。走 /dev 全流程（worktree → PR → Stop Hook 自动合并）。

**Tech Stack:** Markdown only.

---

### Task 1: 创建 MARKER2.md

**Files:**
- Create: `docs/proofs/phase6-e2e/MARKER2.md`

- [ ] **Step 1: 写入文件内容**

文件路径：`docs/proofs/phase6-e2e/MARKER2.md`

内容（严格两行，无尾空行）：

```
# Phase 6 stop-hook loop proof

2026-04-19T21:26:00+08:00 — Stop Hook auto-merge verified
```

- [ ] **Step 2: 验证文件内容符合 PRD 成功标准**

Run:
```bash
test -f docs/proofs/phase6-e2e/MARKER2.md && \
  head -1 docs/proofs/phase6-e2e/MARKER2.md | grep -q '^# Phase 6 stop-hook loop proof$' && \
  grep -qE '2026-[0-9]{2}-[0-9]{2}' docs/proofs/phase6-e2e/MARKER2.md && \
  echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add docs/proofs/phase6-e2e/MARKER2.md
git commit -m "docs: add phase6 stop-hook loop proof"
```

---

## Self-Review

- **Spec coverage**：
  - 成功标准 1（文件存在于 main）→ Task 1 创建 + 后续 /dev 流程 push+PR+merge
  - 成功标准 2（两行 + ISO 日期）→ Task 1 Step 2 校验
  - 成功标准 3（PR 标题无 `[CONFIG]` 前缀）→ finishing 阶段 PR title 用 commit message `docs: add phase6 stop-hook loop proof`
  - 成功标准 4（CI 自动合并）→ engine-ship + Stop Hook 链自动完成
  - 成功标准 5（cleanup）→ Stop Hook 自动 cleanup worktree

- **Placeholder scan**：无 TBD / TODO
- **Type consistency**：N/A（单文件 markdown）
- **不改清单**：Task 1 仅 touch `docs/proofs/phase6-e2e/MARKER2.md`，不碰 packages/apps/scripts/CI/registry/version
