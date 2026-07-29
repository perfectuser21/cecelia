# Controller 格式反馈（Round 1 → Round 2）

本轮合同格式硬检查三项全失败，禁止进入 reviewer，打回重出。

## FAIL 1：contract-dod.md 里 [BEHAVIOR] 条目不足 4

**实际**：DOD 只有 `## [BEHAVIOR] → Invariant 映射` 作为标题，B1-B8 实际写在 contract-draft.md 里，
且各条目不含字面量 `[BEHAVIOR]` 标签。

**要求**：contract-dod.md 里每个验收断言必须以 `[BEHAVIOR]` 开头（字面量），例如：
```
[BEHAVIOR] B1 — push 事件全量短路
断言：...
```
至少 ≥4 条，且每条字面含 `[BEHAVIOR]`。

**修法**：把 contract-draft.md 的 B1-B8 条目移入 contract-dod.md，每条加 `[BEHAVIOR]` 前缀。

## FAIL 2：contract-draft.md 缺 ## E2E 验收 段

**要求**：contract-draft.md 必须包含 `## E2E 验收` 段，说明最终验收的 E2E 手动/自动执行步骤。

**修法**：在 contract-draft.md 末尾新增 `## E2E 验收` 段，列出本 sprint 的端到端验收脚本与命令。

## FAIL 3：contract-dod.md 缺 manual:bash 验收命令

**要求**：contract-dod.md 里至少一条可执行验收命令标注 `manual:bash`，格式如：
```
manual:bash bash packages/engine/tests/integrity/ci-blindspot-contract.test.sh
```

**修法**：在 DOD 的静态断言检查表或 DoD 完成定义旁加一行 `manual:bash <验收命令>`。

## 其他说明
- 内容本身（B1-B8 断言、I1-I6 Invariant、三条静态 grep 命令）质量良好，不用改
- 只需要调整格式：把 [BEHAVIOR] 搬到 DOD、加 ## E2E 验收 段、加 manual:bash 关键字
- push 到同一分支（cp-07291011-ws-241578ce），覆盖现有合同文件
