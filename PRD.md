# PRD — 对齐 phase-event/initiative_run_events stale 测试至新 SSOT 契约

## 背景

我之前的 PR #3334（同步 harness skill 快照至 SSOT cc8e65f）把 SSOT #50「链路审计修复」后的 skill 内容带进 monorepo 快照，删掉了 skill 里的 `phase-event`/`initiative_run_events`/`ts_end`/`cost_usd` 等字面，导致一批断言「skill 含这些字面」的旧测试在全量 brain 套里变红（15 个，分布在 4 个测试文件）。CI 没拦住是因为 brain-unit 用 `vitest --changed`，而这些测试运行时 `fs.readFileSync` 读 SKILL.md（不在 import 图里）→ 改快照不触发它们。

## 决策依据（team-lead，2026-06-11）

phase metrics 的 owner 是 **Brain 侧**，不是 skill：`initiative_run_events` 表 2200+ 行、近 7 天事件全部由 Brain 侧 `events/initiativeRunEvents.js`（图节点生命周期 emitGraphNodeUpdate → write/update）写入；skill 自 06-04 起就没有 phase-event 埋点指令但事件流完整 → skill 侧 curl 埋点自始未在生产生效，#50 清理合理，**不是回归**。故这些「skill 含字面」断言已过时，应改写成断言 Brain 侧 owner。

## 范围

把 4 个测试文件里的 stale skill-content 断言改写为断言 Brain 侧 owner（events/initiativeRunEvents.js 写 initiative_run_events + 三列 / harness.js phase-event 端点 / migration 293），保留各文件里原本有效的 Brain 侧断言。`routes/harness.js` 的 POST/PATCH /phase-event 端点保留不动（向后兼容）。

## 成功标准

- 4 个受影响测试文件全绿；全量 brain 单测里这 15 个 stale 失败清零。
- 改写后的断言校验真实生产机制（Brain 侧 owner），保留回归价值，不再依赖已移除的 skill 字面。
- 不改任何 src 逻辑、不改 skill 快照、不动 phase-event 端点。
