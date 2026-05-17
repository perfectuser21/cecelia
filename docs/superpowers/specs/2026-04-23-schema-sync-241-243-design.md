# Schema Version Sync: selfcheck.js 241 → 243

**日期**: 2026-04-23
**Brain Task**: `e8902f66-8b17-4072-92ed-f79328c0899b`
**分支**: `cp-0423070024-schema-sync-241-243`

---

## 问题

`packages/brain/src/selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION = '241'`，但 `packages/brain/migrations/` 下最新是 `243_clear_pre_flight_rejected_backlog.sql`。

facts-check（`scripts/facts-check.mjs`）运行时会对比两者，一旦不一致就 exit 1。这导致：

- 任何 push 里只要有文件路径在 `packages/brain/` 下，`hooks/bash-guard.sh` 的 local-precheck 就会调 facts-check → 失败 → 阻止 push
- CI 里同名 check 也会失败

根因：#2515 合并时 bypass 了 facts-check（通常 `[CONFIG]` 前缀 + 管理员权限会跳过某些 gate），导致 migration 242/243 落地但 `EXPECTED_SCHEMA_VERSION` 没同步 bump。

## 影响

PR #2538 推送 `docs/design/v2-scaffolds/` 时第一次触发了这个坑（当时 README 还在 `packages/brain/src/` 下）。必须先修了这个才能继续后续所有 Brain 改动（P2 Spawn Middleware / P3 Workflow Registry / P4 Observer 分离等）。

## 方案

1 行修改：

```js
// packages/brain/src/selfcheck.js:23
export const EXPECTED_SCHEMA_VERSION = '243';
```

没有其它可选方案：241 是错的，243 是唯一正确值。

## 为什么不顺手加防御

**不加**：

- 「自动从 `migrations/` 目录读最高号当 expected」—— 看似聪明，但会丧失「明示声明」的安全性（有人加错 migration 号可以自动匹配过去，而不是被 facts-check 拦住）。当前这种「显式常量 + facts-check 比对」的二相验证是有意设计。
- 「加一个 pre-commit hook 强制 migration 号同步更新常量」—— 属于 engine-devline 的工作，超出本 task 范围。若需要可以单独 issue。

## DoD

- [BEHAVIOR] EXPECTED_SCHEMA_VERSION 改为 243
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!c.includes(\"EXPECTED_SCHEMA_VERSION = '243'\"))process.exit(1)"`
- [BEHAVIOR] facts-check 通过
  Test: `manual:node scripts/facts-check.mjs`

## 风险

**无功能性影响**。`EXPECTED_SCHEMA_VERSION` 只是 selfcheck 启动时对比 DB migration 版本的阈值，改高后：

- 生产 Brain 启动若 DB 在 243 → 通过（正常路径）
- 生产 Brain 启动若 DB 卡在 ≤ 242 → selfcheck 拒绝启动并告警（这本来就是期望的，promote 生产 DB 到 243 是独立动作）

本机/Brain 容器内 DB 已经是 243（PR #2515 自动 apply 过）。
