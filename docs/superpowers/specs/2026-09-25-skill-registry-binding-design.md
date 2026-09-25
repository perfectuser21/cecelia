# getSkillForTaskType 改查 skill_registry：能力账本参与执行时选择

日期：2026-09-25　任务：Brain 9917a588（链 bf5088a3 第 7 棒，原单 ef12ec5d）　决策：105a5868（C 档，报备即做）

## 0. 结论

审计事实：`executor.js` 的 `getSkillForTaskType` 只读硬编码 `EXECUTOR_SKILL_MAP`（task_type→skill 命令），`skill_registry` 与 `ops_skills` 只用于展示对账——账本改了，执行不变，账实分叉。本刀让 `skill_registry` 成为 task_type→skill 的**运行时真身**，硬编码降为兜底并对漂移告警。

## 1. 数据模型（迁移 470，只加列，不动既有列）

`skill_registry` 新增两列：

| 列 | 含义 |
|---|---|
| `task_types TEXT[] NOT NULL DEFAULT '{}'` | 该 skill 承接的 task_type 名单（GIN 索引） |
| `dispatch_command TEXT` | 派发命令原文，缺省为 `'/' \|\| name`；用于 `/review init` 这类带参数命令 |

选数组列而非新表：任务要求"读 skill_registry"，且改映射 = 改这一行（Notion 镜子/运维台同一处可见）。约束：同一 task_type 被多行声明时按 `name` 升序取第一行并记 conflict（晨报 AMBER），不静默择一。

回填：迁移里把 `EXECUTOR_SKILL_MAP` 里全部非空条目按 skill 名分组，幂等 UPSERT——`task_types` 取并集、`dispatch_command` 只在原值为空时写，**不覆盖**已有行的其它列。`research: ''`（刻意不挂 skill）不入账。测试解析迁移 SQL 与 `EXECUTOR_SKILL_MAP` 逐项比对，防回填与硬编码起点不一致。

## 2. 解析（`lib/skill-binding-registry.js`）

`getSkillForTaskType` 保持同步签名（现有测试与调用方不变），改读**进程内快照**：

- `ensureSkillBindingsFresh(pool)`：`preparePrompt`（本来就是 async）在解析前调用；快照 TTL 60s，TTL 内零查库；并发调用共享同一个在途查询；单次查询 `Promise.race` 超时 800ms；失败保留旧快照（没有则为空）并进入 30s 退避——**失败开放，回落硬编码，绝不拖垮派发**。
- 解析次序：`payload.skill_override`（原样保留在 `preparePrompt`，最优先）→ payload 特判（decomposition/next_action，原样保留）→ content_publish 平台路由（原样保留）→ **registry 绑定** → 硬编码兜底 → `/dev`。
- 只认 `status <> 'planned'` 的行（deprecated 仍在跑遗留 headless，不能断）。

## 3. 漂移告警

| 情形 | 行为 |
|---|---|
| registry 有、硬编码有、值不同 | 用 registry；`console.warn` 一次（每 task_type 每进程一次） |
| registry 缺、硬编码有（非空） | 走硬编码；`console.warn` 一次 |
| 两边都没有 | 沿用 `/dev` 默认，不告警（大量内联路由类型本来就没有 skill） |
| 多行认领同一 task_type | 取 name 升序第一行；warn |

`detectSkillBindingDrift(pool)` 直接查库（不走快照）产出 `{missing, mismatched, conflicts}`，两处出口：

- 日报 `buildReportText` 新增「skill 绑定漂移」板块（`renderSkillBindingSection`，复用棒 1 裸跑板块同款 🟡 AMBER 形状）；
- 晨报 `morning-cockpit-bark` 新增一行 🟡 AMBER（best-effort，失败不出行不拖垮晨报）。

## 4. 验收

1. 改 `skill_registry` 某行 `task_types`/`dispatch_command`，无需改代码，≤60s 内新任务用新 skill（PG 集成测试真库演示，含快照过期后生效）。
2. 从 registry 删掉某映射 → 解析走硬编码 + 晨报/日报出 AMBER。
3. `payload.skill_override` 仍优先。
4. registry 查询失败/超时 → 回落硬编码，`preparePrompt` 不抛。
5. 缓存生效：TTL 内多次解析只查库一次。

## 5. 不做

- content_publish 的 platform→publisher 表仍在代码里（它是 payload 维度不是 task_type 维度），列为后续；
- `SKILL_WHITELIST` / `TASK_TYPE_TO_SKILL` 两份 task_type→skill 目录名表不动；
- 不新增 Notion 列（digest 只含 name/description/status/location，新列不触发重推）。
