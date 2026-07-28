# Kernel Behavior Equivalence Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 root regression contract 与承诺地图上建立可机器校验、不会把静态文档伪装成证明的 Kernel P0/P1 等价收账。

**Architecture:** 根 `regression-contract.yaml` 增加唯一 `behavior_equivalence` section；纯函数 validator/projector 计算 effective status、evidence envelope 和既有 journey cell 投影，CLI 生成/核对诚实报告。实现不建表、不写 DB、不触碰 ReleaseRun/risk 控制流。

**Tech Stack:** Node.js ESM、Vitest、js-yaml、Markdown/JSON、现有 regression contract。

---

## File map

- `regression-contract.yaml`：唯一 P0/P1 behavior inventory 与 proof matrix SSOT。
- `packages/brain/src/lib/kernel-behavior-equivalence.js`：纯 validator、projector、report model。
- `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`：正常、对抗、伪绿、gap、freshness、supersession 测试。
- `scripts/ci/check-kernel-behavior-equivalence.mjs`：读取根 SSOT、运行 validator、输出 JSON/Markdown、`--check-report` 漂移门。
- `docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md`：确定性最终报告，必须保留 gap。
- `packages/brain/DEFINITION.md`、`DEFINITION.md`、版本文件：Brain 行为定义与版本同步。

### Task 1: Validator RED

**Files:**
- Create: `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`
- Create: `packages/brain/src/lib/kernel-behavior-equivalence.js`

- [ ] 写 failing tests，使用 `validateBehaviorEquivalence(contract, { now })` 期望：
  `claimed_status=proven` 缺任一 Provider/scenario、exact SHA/version、verified/expires、
  effect receipt 时返回 `effective_status=gap` 与 finding。
- [ ] 写 failing tests 拒绝 `README.md`、`rg/grep`、`test -f` 和只查关键词的伪绿命令。
- [ ] 写 failing tests 验证 stale proof 投影 pending/red，不得 green。
- [ ] 写 failing tests 验证 supersession 悬空和环产生 finding。
- [ ] 运行：
  `cd packages/brain && npx vitest run src/lib/__tests__/kernel-behavior-equivalence.test.js`
  预期因模块/API 不存在失败。
- [ ] 提交 RED。

### Task 2: Minimal validator/projector GREEN

**Files:**
- Create: `packages/brain/src/lib/kernel-behavior-equivalence.js`
- Test: `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`

- [ ] 定义 canonical steps `S0..S12`、11 dimensions、providers
  `claude/codex/grok`、scenarios `normal/violation/recovery`。
- [ ] 规范化 behavior：
  `claimed_status` 保留原声明；证明缺口写 `findings[]` 并强制
  `effective_status=gap`。
- [ ] 只有完整、未过期、命令可执行且非伪绿的 3×3 proof matrix 可 effective proven。
- [ ] intentional replacement 额外要求 legacy/replacement/rationale 与完整 proof。
- [ ] `projectJourneyCells()` 输出 `{step, dimension, cell_status, assertion_ref, reason}`，
  只投影不写 DB。
- [ ] `buildEvidenceEnvelopes()` 对每个 provider/scenario 输出 exact 字段，缺值保持
  `null`。
- [ ] 运行聚焦测试，预期全绿。
- [ ] 提交 GREEN。

### Task 3: Root SSOT Inventory RED/GREEN

**Files:**
- Modify: `regression-contract.yaml`
- Modify: `packages/quality/__tests__/regression-contract.test.js`

- [ ] 先扩 regression-contract test，要求存在 S0-S12、11 dimensions、P0/P1 behaviors、
  三 Provider 三场景键，并验证 assertion_id 指向 `golden_paths[].id`。
- [ ] 运行 quality test，预期当前 root contract 缺 section 而失败；提交 RED。
- [ ] 在 root contract 增加 `behavior_equivalence`，收录旧 Claude：
  branch protection、credential guard、branch/push guard、stop/orphan guard、
  DevGate/TDD、CI、Evaluator/Judge、human review、merge、staging/production、
  report/learning。
- [ ] 每条明示 `status`、legacy evidence、Kernel construct、S0-S12、11维、freshness、
  supersession、owner、gap reason/closure plan 与 provider matrix。
- [ ] 不存在真实 3×3/effect receipt 的条目声明 `gap`，不得虚构生产 receipt。
- [ ] 在 `golden_paths` 登记 validator 命令，使同一 root SSOT 自守。
- [ ] 运行 quality + validator tests，预期全绿；提交 GREEN。

### Task 4: CLI and Honest Report RED/GREEN

**Files:**
- Create: `scripts/ci/check-kernel-behavior-equivalence.mjs`
- Create: `docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md`
- Test: `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`

- [ ] 先写 report tests，要求统计 P0/P1、状态、S0-S12×11、Provider 3×3、freshness、
  proven-to-fire commands、所有 gap/closure plan。
- [ ] 运行测试，预期 report formatter 缺失失败；提交 RED。
- [ ] 实现 CLI：
  默认 validation summary；`--format=json|markdown`；`--write-report`；
  `--check-report` 比较确定性输出。
- [ ] 生成 Markdown 报告；确认 gap 数量非零时仍 exit 0，但 false-proven finding exit 1。
- [ ] 增加禁止同义表检查：扫描 migrations/production SQL，不允许
  `CREATE TABLE ... behavior_ledger`；文档中历史/禁令提及不算建表。
- [ ] 运行 CLI 与 tests，预期通过；提交 GREEN。

### Task 5: Version and final verification

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`

- [ ] 将 Brain patch 版本从 `1.268.2` 更新到下一个未占用版本。
- [ ] 记录 Behavior Equivalence 合同、effective gap 与回滚边界。
- [ ] 运行：
  - `cd packages/brain && npx vitest run src/lib/__tests__/kernel-behavior-equivalence.test.js`
  - `cd packages/quality && npx vitest run __tests__/regression-contract.test.js`
  - `node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report`
  - `bash scripts/check-version-sync.sh`
  - `git diff --check`
- [ ] 审计未修改 ReleaseRun/risk 实现文件、未新增 migration/table。
- [ ] 提交版本与报告，汇报 base/head/cherry-pick 顺序。
