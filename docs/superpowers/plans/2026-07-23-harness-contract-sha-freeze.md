# Harness Contract SHA Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 reviewer 批准证据绑定到不可变 Git commit，并从该 commit 冻结合同内容。

**Architecture:** `ground-truth` 发现 branch+SHA，dispatcher 把 SHA 写入 reviewer TaskBundle，callback 将服务端 TaskBundle 的 SHA写入 append-only verdict。loop 使用该 SHA 通过安全 Git reader 读取三份合同文件，再调用现有原子 contract store。

**Tech Stack:** Node.js ESM、Vitest、Git CLI、PostgreSQL、Express。

---

### Task 1: 先写完整回归防线

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/loop.test.js`
- Create: `packages/brain/src/orchestrator/__tests__/git-artifact-reader.test.js`

- [ ] 写测试：branch+SHA 同行解析，SHA 不同的 reviewer verdict 必须 stale。
- [ ] 写测试：reviewer bundle 与 callback verdict 都含服务端 `contract_sha`。
- [ ] 写测试：loop 只调用 `readGitFile(approvedSha, path)`，当前 worktree 无文件仍可物化。
- [ ] 写真实临时 Git 仓库测试：移动 branch 后，旧 SHA 仍读回旧合同。
- [ ] 运行定向测试，预期因字段/模块/行为尚不存在而失败。
- [ ] 只提交测试：`test(harness): cover immutable approved contract artifacts`。

### Task 2: 最小实现

**Files:**
- Create: `packages/brain/src/orchestrator/git-artifact-reader.js`
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/run.js`

- [ ] 用 `execFileSync('git', ['show', sha + ':' + path])` 实现安全 reader；校验 SHA 与 repo-relative path。
- [ ] 传播 `proposeBranchSha` 和 `ganLatestRoundContractSha`，SHA 不匹配时 verdict 不生效。
- [ ] reviewer TaskBundle/callback verdict 传播 `contract_sha`。
- [ ] loop 从 SHA 读取三份 artifact；缺失/非法时 fail closed。
- [ ] 运行 Task 1 定向测试，预期全绿。
- [ ] 提交实现：`fix(harness): freeze approved contract artifacts by commit`。

### Task 3: 版本、smoke 与全量验证

**Files:**
- Create: `packages/brain/scripts/smoke/harness-contract-sha-freeze-smoke.sh`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`

- [ ] 新增 smoke，真实建临时 Git 仓库并验证 SHA 冻结与路径拒绝。
- [ ] Brain 版本从 `1.267.43` bump 到 `1.267.44`，同步五处版本。
- [ ] 运行 orchestrator、callback、真实 PostgreSQL 定向套件。
- [ ] 运行 smoke、facts-check、version-sync、DoD mapping、`node --check`、diff check。
- [ ] 提交：`chore(brain): release 1.267.44`。
- [ ] Push、开 PR、等所有 CI；合并并确认 Gate3 health 为 1.267.44/merge SHA。
- [ ] 恢复 fire drill，验证 contract row 后继续到 generator/evaluator/human-review。
