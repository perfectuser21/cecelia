# GAN Reviewer Feedback - Round 1
verdict: REVISION
score: 25/35

## 需要修订的三处问题

### 1. atomicity（原子性缺失）
contract-draft.md 的"改动范围"段只列 `packages/brain/src/harness-skill-relay.js`，
但 PRD T1-T3 要求新增 `packages/brain/tests/dispatch-worker-relay.test.js`。
**修订**：改动范围补"新增文件：packages/brain/tests/dispatch-worker-relay.test.js
（T1/T2/T3 单元测试，commit 顺序：先 failing commit → 再 passing commit）"

### 2. invariant_coverage（缺独立 BEHAVIOR 条目）
dispatch-worker.mjs 不可改动是 PRD 明确 Invariant，DoD 中仅 checklist 项，
无自动验证命令。需补 [BEHAVIOR-7]：
```bash
git diff main..HEAD -- scripts/dispatch-worker.mjs | wc -l
# 期望：0
```

### 3. risk_coverage（容器路径分析缺失）
合同 FR-1 说"调用 node scripts/dispatch-worker.mjs"，但未说明容器内如何定位该文件。
**修订**：contract-draft.md 补充：生产路径使用
`path.resolve(__dirname, '../../../scripts/dispatch-worker.mjs')` 或等价绝对路径，避免容器内 cwd 歧义。
