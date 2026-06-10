# Learning：harness_initiative → okr_initiatives 纯加数据迁移（PR 2b-2a）

## 背景
Phase 2b-2 拆成 2b-2a（纯加数据迁移）+ 2b-2b（行为切换）。本 PR = 2b-2a：
把执行侧 228 个 `task_type='harness_initiative'` 任务对齐到规划侧 `okr_initiatives`，
`initiative_runs` 加列挂到 okr_initiatives。**纯加 / 完全可逆 / 零代码零行为变更**，为 2b-2b 铺路。

## 根本原因（踩的坑）
1. **携带 task.project_id 直插 okr_initiatives 触发 FK 违例**：okr_initiatives.project_id 有 FK→okr_projects（298 加），
   但 harness 任务的 project_id 有指向已不存在/别表 id 的（如 `0000...3a0bc61a`）。
   → 迁移携带外键字段时必须 `CASE WHEN x IN (SELECT id FROM 目标表) THEN x ELSE NULL`，不能盲信源表外键有效。
2. **smoke 的"破坏性语句"正则误伤回滚说明注释**：注释里写 `DELETE FROM` / `DROP TABLE`（回滚指引）被
   `/DELETE\s+FROM/i` 命中。→ 扫描可执行语句前先剥离 `-- ` 注释行。
3. **生成 uuid 的 CTE 被多次引用会重算**：`gen_random_uuid()` 在两处引用同一 CTE（建 okr_initiatives + 建映射表）
   时若不 `AS MATERIALIZED` 会产生不同 uuid → 两表对不上。→ 跨引用复用生成值必须 `WITH x AS MATERIALIZED`。
4. **INSERT 必须显式给 status**：okr_initiatives.status 默认 `'pending'`，但 299 的 CHECK 已禁止它 → 默认值会违例。

## 下次预防
- [ ] 迁移携带外键列前，先 `CASE WHEN ... IN (SELECT id FROM 目标表)` 过滤无效引用，别信源表 FK
- [ ] migration 结构 lint 扫危险语句前先剥离 `--` 注释，避免误伤回滚说明
- [ ] CTE 里 `gen_random_uuid()`/`now()` 等 volatile 值被多处引用 → `AS MATERIALIZED` 固定
- [ ] 给有 CHECK 约束的列 INSERT 时显式赋值，别依赖旧默认值
- [ ] 纯加迁移自带回滚说明 + 用相对不变量（非写死行数）写 smoke，CI 空库也成立

## 验证
- 本地 cecelia：映射表 228、新建 okr_initiatives 228、status 映射（failed 146/done 45/cancelled 35/archived 1/queued 1）、
  initiative_runs 回填 146 filled + 4 null（悬空 run）
- 幂等：重跑映射表仍 228（NOT EXISTS 守卫）
- cecelia_test：migrate.js（CI 路径）应用 300 无错
- smoke 5/5 PASS（结构 + 4 个相对不变量）

## 遗留（2b-2b 须知）
本 PR 不动 `initiative_runs.initiative_id`（双跑/回滚）、不改代码。2b-2b 切 harness 读写 okr_initiatives
（认领 planned、initiative_runs 用 okr_initiative_id），最终再下线旧 initiative_id 与 harness_initiative task_type。
