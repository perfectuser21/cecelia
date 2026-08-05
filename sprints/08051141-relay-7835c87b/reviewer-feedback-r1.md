# Proposer 格式打回（第1轮，合同格式硬检查失败）

## 失败项

### ❌ FAIL 1: contract-dod.md 缺 [BEHAVIOR] 标签（需 ≥4 条）
当前 contract-dod.md 使用 `- [ ]` checkbox 格式，但 harness 要求明确的 `[BEHAVIOR]` 行。
每条可验证的行为断言必须用如下格式：
```
[BEHAVIOR] FR-1: 步骤行点击展开 StepLedgerPanel
  - given: 全貌页已加载，步骤数 > 0
  - when: 点击 data-testid="step-row-clickable" 行
  - then: data-testid="step-ledger-panel" 变为 visible
```
至少需要 FR-1 到 FR-8 的 8 条 [BEHAVIOR] 条目（≥4 即满足门禁，目标 8 条）。

### ❌ FAIL 2: contract-draft.md 缺 `## E2E 验收` 段
contract-draft.md 必须有一个 `## E2E 验收` 的一级/二级标题段，列出 E2E 验收脚本/场景（即使内容已存在于其他格式，也必须有这个标题）。

### ❌ FAIL 3: contract-dod.md 缺 `manual:bash` 可执行验收命令
每个主要验收步骤需要 bash 可执行命令，格式如：
```
manual:bash npx playwright test sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts --headed
```

## 修复要求

1. 在 contract-dod.md 中添加 `## 行为断言（[BEHAVIOR]）` 段，至少包含 FR-1~FR-8 的 8 条 `[BEHAVIOR]` 条目，使用 given/when/then 格式
2. 在 contract-draft.md 中添加 `## E2E 验收` 段，列出 Playwright E2E 验收场景（可复用现有 Scenario 1-5 内容）
3. 在 contract-dod.md 中对每个关键验收项添加 `manual:bash` 可执行命令

其余内容（FR-1~FR-8 断言、data-testid 锚点、场景地图、Invariant 约束）质量良好，保留不变。

## 注意
- tests/e2e-gp-drill.spec.ts 已存在且质量良好，无需改动
- 改动仅限 contract-dod.md 和 contract-draft.md 的格式补充
