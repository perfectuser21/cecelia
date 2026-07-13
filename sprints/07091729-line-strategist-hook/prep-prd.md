# 小改动 PrepPRD：Line 军师终态接线 + 两处工程收尾（PR3，拆分后范围）

> 原 T3 任务 5 项中的「decomp + decomp-check 合并 relay 加 ability 侧入口」已按用户拍板拆出，
> 另立 skill-creator 任务单独跑（不占用本 PR，不算 CI，走 zenithjoy-skills 仓库）。
> 本 PR 范围收窄为 3 项 Brain 工程改动：终态事件钩子 + 路由注册 + 两处表结构/部署收尾。

## 改什么

1. **Brain 终态事件钩子**（新增）：在 task 状态更新为 `completed`/`failed` 处（`packages/brain/src/tick-runner.js` 或 executor 更新点）挂钩——按其 `journey_id`（line）建一个 `task_type=strategist_decision` 的新任务，`payload.journey_id` 传所属 line，dispatch 时环境变量传 `LINE_ID`/`TRIGGER=run_terminal`/`TRIGGER_CONTEXT`。**建之前先查重**：`GET /api/brain/tasks?status=queued&task_type=strategist_decision` 过滤同 `journey_id` 是否已存在，存在则跳过（防抖去重）。

2. **task_type=strategist_decision 注册路由**：`packages/brain/src/task-router.js` 的 `VALID_TASK_TYPES` + `LOCATION_MAP` + `SKILL_WHITELIST` 三处新增 `strategist_decision` → 对应 skill `line-strategist`，location 定为 `us`。

3. **advancement_items 表结构**：新 migration（325号）—— 加 `journey_id UUID REFERENCES journeys(id)` 列；`ability_id` 去掉 `NOT NULL` 约束（允许推进项挂纯 line 层级、暂未绑定具体 ability）。

4. **Bark token 补进 Brain 容器 env**：`docker-compose.yml` 的 `node-brain.environment` 加 `- BARK_TOKEN=${BARK_TOKEN:-}`；`.env.docker.example` 补充字段说明；实际 `.env.docker` 从 `~/.credentials/bark.env` 补值。

## 为什么改
承接 T2（PR2 ability_id 全链接线，已合并，cecelia#3667）——完成"任务终态→line 军师自动决策"的闭环，同时补齐 advancement_items 缺 journey_id、Bark 容器 env 缺口导致告警推送在生产容器内静默失效两处工程债。

## 关联上下文
- Journey：Cecelia Harness Pipeline（`bb8cc561-b3ee-4fec-b74d-2255694bd963`）
- 前置：T2（bd0478b7，已 completed，PR #3667 已合并）
- battle-plan-20260708.md 记录的作战清单第 3 项（本 PR 为拆分后范围）
- 拆出项：decomp+decomp-check 合并 → 另立 skill-creator 任务

## 影响范围
- Brain 侧：新增事件钩子 + 路由注册 + migration，不改现有 task 状态机语义
- 部署侧：Bark env 变量需要在下次 brain-deploy 时真正生效（容器重建非 reload）

## 验收标准
- [ ] task 落 completed/failed 后能观察到对应 line 生成一条 `strategist_decision` 任务（且同 line 短时间内不重复生成）
- [ ] `task-router.js` VALID_TASK_TYPES/LOCATION_MAP/SKILL_WHITELIST 均含 `strategist_decision`，单测覆盖
- [ ] migration 325 应用后 `advancement_items` 表有 `journey_id` 列，`ability_id` 允许为 NULL
- [ ] docker-compose.yml 含 `BARK_TOKEN` env 透传，brain-deploy 后容器内 `process.env.BARK_TOKEN` 非空（`docker exec` 验证）
- [ ] CI 全绿
