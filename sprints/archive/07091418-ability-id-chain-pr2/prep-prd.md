# 小改动 PrepPRD：ability_id 全链接线 PR2 —— relay/initiative_runs/report/tasks 过滤 7 处接线

## 改什么

1. **relay spawn env 加 CECELIA_ABILITY_ID**
   `packages/brain/src/harness-skill-relay.js`（约第245-256行 spawnFn env 对象）：仿照现有 `CECELIA_JOURNEY_ID: task.payload?.journey_id || ''` 写法，加一行
   `CECELIA_ABILITY_ID: task.ability_id || task.payload?.ability_id || ''`。

2. **initiative_runs 加 ability_id 列**
   新增 migration `packages/brain/migrations/323_initiative_runs_ability_id.sql`：
   `ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS ability_id UUID REFERENCES journey_features(id);`
   并在创建/更新 initiative_runs 记录的相应代码路径里写入该列（起跑时从 task.ability_id 带入）。

3. **report Phase B 加第9个 push 函数 pushAdvancementItems**
   `packages/brain/src/notion-push-sync.js`：仿照现有 journey_features 等 push 函数的字段映射写法（如第140-141行 thickness→Notion select 映射），新增 `pushAdvancementItems`，把 `advancement_items` 表（PR1 已建）同步进 Notion，并接入 Phase B 的第9个调用位。

4. **PR merged 回写推进项 done/pr_url + 修 thickness:"done" 无效值 bug**
   `packages/workflows/skills/harness-report/SKILL.md`（约第293-295行）：
   - 现状 bug：`curl -X PATCH .../journey_features/$FEATURE_ID -d '{"thickness":"done","status":"done"}'`，而 `VALID_THICKNESS = ['thin','medium','thick','mature']`（`packages/brain/src/routes/journeys.js` 第7行），"done" 不在合法值内，PATCH 恒 400（被 `|| echo WARN` 静默吞掉，从未真正生效）。改为只传 `{"status":"done"}`（不传 thickness，或按实际厚度传合法值）。
   - 新增：PR merged 后，若本次 run 关联了 `advancement_item_id`，调用已有 PR1 端点 `PATCH /api/brain/advancements/:itemId -d '{"status":"done","pr_url":"<PR_URL>"}'`（`packages/brain/src/routes/abilities.js`），把对应推进项标记完成并回填 PR 链接。

5. **issues journey_id 回填卫生**
   `packages/brain/src/test-lifecycle-patrol.js`（约第80行）INSERT INTO issues 缺 journey_id 字段，是历史 null 的持续来源之一。补上：若该 issue 有可推断的 journey 归属（如从 sub_area/关联上下文能定位），INSERT 时带上 `journey_id`；无法推断时显式传 NULL（不做无依据的猜测回填），避免继续制造新的 null 记录。

6. **修复 `GET /api/brain/tasks?journey_id=` 过滤不生效**
   `packages/brain/src/routes/task-tasks.js`（约第170-207行）：query 解构里根本没有 `journey_id`，且 tasks 表无顶层 journey_id 列（只在 `payload` JSONB 里）。修复：解构加 `journey_id`，SQL 条件加
   `if (journey_id) { conditions.push(\`payload->>'journey_id' = $${paramIndex++}\`); params.push(journey_id); }`。

7. **tasks.ability_id 现状核实（无需改动）**
   `POST /api/brain/tasks` 已支持接收并落库 `ability_id`（`task-tasks.js` 第58/137/140/154行，对应迁移 297），核实属实，此项本次不改代码，仅在验收里做一次回归确认。

## 为什么改

延续 [[spec-advancement-model-design]] PR1（advancement_items 表 + abilities 三端点 + war room 前端已上线）。PR1 补齐了推进项账本本体，但三根数据流断线里，ability 维度从点火（relay env）到运行留痕（initiative_runs）到收尾回写（report）还没有真正接通；同时军师 eval 已实锤 issues.journey_id 全 null 和 tasks?journey_id= 过滤失效两个卫生问题，顺手一并修掉。

## 关联上下文

- 相关 Journey：Cecelia Harness Pipeline（`bb8cc561-b3ee-4fec-b74d-2255694bd963`）
- 相关历史决策：`spec-advancement-model-design.md` PR1 SHIPPED（PR #3635），本次为其明确列出的 "PR2 待做" 清单
- 相关 migration：238/300/312/317/322（journey_id/ability_id 沿革），本次新增 323

## 影响范围

- Brain 后端：harness-skill-relay.js、notion-push-sync.js、routes/task-tasks.js、新 migration
- Skill 侧：harness-report SKILL.md（PATCH payload 修正 + 新增 advancement 回写步骤）
- 不影响：前端 dashboard（本次不改 UI，进度条已在 PR1 接好）
- 不改动 abilities.js 现有三端点（PR1 已验证生产可用，仅复用）

## 验收标准

- [ ] migration 323 应用成功，`initiative_runs` 表出现 `ability_id` 列
- [ ] relay 起跑一个带 ability_id 的 task，容器内 env 能读到非空 `CECELIA_ABILITY_ID`
- [ ] `pushAdvancementItems` 单元测试通过，且能在测试/预发环境跑一次真实 push 不报错
- [ ] harness-report SKILL.md 里 PATCH journey_features 不再传 `thickness:"done"`，且新增的 advancement PATCH 调用可用真实 advancement_item_id 验证一次 200
- [ ] `curl "localhost:5221/api/brain/tasks?journey_id=<真实id>"` 返回结果只包含该 journey 的任务（非全量）
- [ ] CI 全绿
