# Learning: cp-06100848 双轴模型 Phase 1 — tasks.ability_id 十字边

## 背景
给 `tasks` 加 `ability_id` 外键（双轴工作模型执行轴↔能力轴的十字边），migration 296 + 任务创建 API 接线 + TDD。

## 踩到的两个非显而易见的坑

### 坑 1：新增 migration 必须同步三处 schema 版本，否则 DevGate facts-check FAIL

加一个 `migrations/296_*.sql` 后，`node scripts/facts-check.mjs` 连环失败两次：
1. `selfcheck_version_sync`：`packages/brain/src/selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` 常量必须 = 最高 migration 号。
2. `schema_version`：`DEFINITION.md` 里 `Schema 版本: NNN` 那行也必须同步。

### 根本原因
facts-check 三方交叉校验：**最高 migration 文件号 ↔ selfcheck.js 常量 ↔ DEFINITION.md 文档**。三处任一不同步即 FAIL。这是 SSOT 一致性门禁，不是 bug。加 migration 不是"加个文件"，是"改 schema 版本"，三处必须同时动。

### 坑 2：worktree 无 node_modules，跑 vitest / migrate.js 前需软链主仓库两处

engine-worktree 建的 worktree **不含 node_modules**，直接 `node src/migrate.js` 或 vitest 报 `ERR_MODULE_NOT_FOUND`（dotenv/pg）。本仓库 node_modules 在两处：根 + `packages/brain/`。

### 下次预防
- [ ] 加 migration 时，同一个 commit 一起改 `selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` + `DEFINITION.md` 的 `Schema 版本` 行，三处对齐最高 migration 号。
- [ ] push 前本地必跑 `node scripts/facts-check.mjs`，绿了再 push（避免 CI 才发现 schema 漂移）。
- [ ] 在 worktree 跑测试/migration 前先软链：`ln -s <main>/node_modules node_modules && ln -s <main>/packages/brain/node_modules packages/brain/node_modules`。
- [ ] CLAUDE.md 里 DevGate 第三条 `check-dod-mapping.cjs` 路径已过时（脚本不存在，现为 check-dod-purity.cjs 等），不要照抄；以 `packages/engine/scripts/devgate/` 实际文件为准。

## 关联
- Spec: docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md
- Plan: docs/superpowers/plans/2026-06-10-phase1-task-ability-edge.md
- Decision: 双轴工作模型 + Initiative 合一（decisions ccce2e29）
