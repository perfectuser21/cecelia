# Learning: cp-06100848 双轴模型 Phase 1 — tasks.ability_id 十字边

## 背景
给 `tasks` 加 `ability_id` 外键（双轴工作模型执行轴↔能力轴的十字边），migration + 任务创建 API 接线 + TDD。

## 踩到的三个非显而易见的坑

### 坑 1：migration 号会和 main 撞车（并行 PR）

本地建分支时最高号是 295，写了 `296_tasks_ability_id.sql`。但开 PR 时 main 已经合入了**另一个** `296_notes_initiative_id.sql`（别的 PR），两个 296 撞号。CI `lint-migration-unique-version` 直接 FAIL。

### 根本原因
migration 号是全局递增的稀缺资源，并行 PR 各自占号会撞。`lint-migration-unique-version` 拦的就是 W7.4 那次同号事故（Brain 启动按字母序只跑第一个，第二个被静默跳过 → schema drift）。

### 坑 2：`EXPECTED_SCHEMA_VERSION` 是"地板"，不要随 migration 上调（重要反直觉）

本地 `facts-check` 的 `selfcheck_version_sync` 会报 "selfcheck='293' but highest migration='296'"，诱导你把 `EXPECTED_SCHEMA_VERSION` 改成最高号。**别改**——
- 它的语义是"DB 必须 >= 此版本"的**最低可接受地板**（见 selfcheck.js 注释），不是"等于最高号"。
- main 实证：294/295/296 一路加上去，`EXPECTED_SCHEMA_VERSION` 始终是 `'293'` 没动过。
- `selfcheck.test.js` 硬断言 `expect(EXPECTED_SCHEMA_VERSION).toBe('293')`，是 **CI brain-unit 门禁**。你一改它就挂 CI。
- `facts-check` 的那条严格相等检查是**本地 DevGate**、**不在 CI 门禁集**里，且 main 自己都不满足它（293 vs 296）。CI 才是合并的权威。

→ **结论：加 migration 时不要碰 `EXPECTED_SCHEMA_VERSION` 和 DEFINITION.md 的 Schema 版本行。**

### 坑 3：worktree 无 node_modules

engine-worktree 建的 worktree **不含 node_modules**，直接 `node src/migrate.js` 或 vitest 报 `ERR_MODULE_NOT_FOUND`（dotenv/pg）。本仓库 node_modules 在两处：根 + `packages/brain/`。

## 下次预防
- [ ] 写 migration 前先 `git fetch origin main && git ls-tree origin/main packages/brain/migrations/ | tail`，取真正的下一个空号；开 PR 时若 main 又前进了，rebase 后重新确认没撞号。
- [ ] 加 migration **不要**改 `EXPECTED_SCHEMA_VERSION` / DEFINITION.md Schema 版本行——它是地板不是镜像。本地 facts-check 那条报错是噪音（main 也不满足）。
- [ ] `feat:` + 触及 `packages/brain/src/` → 必须新增 `packages/brain/scripts/smoke/<feature>-smoke.sh`（≥5 实代码行 + ≥1 个 curl/psql/docker/node 真命令），且 smoke 文件要**commit**后 lint 才看得到（lint 看 `origin/main...HEAD` 提交历史，不是暂存区）。
- [ ] 在 worktree 跑测试/migration 前先软链：`ln -s <main>/node_modules node_modules && ln -s <main>/packages/brain/node_modules packages/brain/node_modules`。
- [ ] CLAUDE.md 里 DevGate 第三条 `check-dod-mapping.cjs` 路径已过时（脚本不存在），以 `packages/engine/scripts/devgate/` 实际文件为准。

## 关联
- Spec: docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md
- Plan: docs/superpowers/plans/2026-06-10-phase1-task-ability-edge.md
- Decision: 双轴工作模型 + Initiative 合一（decisions ccce2e29）
