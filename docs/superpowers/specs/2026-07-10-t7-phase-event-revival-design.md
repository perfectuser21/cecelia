# T7 设计：phase-event 复活 + zombie-reaper 心跳判活

任务：e6081739-4bd5-4828-9a18-52362ad12709（plan=nine-elements-integrity seq=7）
上游设计：`docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md`（已批准）
Research 审批：APPROVE（2026-07-10，含 3 条非阻塞修正，已吸收进本设计）

## 背景

- `initiative_run_events` 自 07-04 起零写入：LangGraph→skill-relay 架构切换时，细粒度阶段追踪的写入方（图节点）被移除。API 端点还在（`POST/PATCH /api/brain/harness/phase-event`，harness.js:1713/1740），只是没人调用。
- zombie-reaper 以 `tasks.updated_at` 为单一判活信号，是 07-10 两次 T5/T6 误杀的根因之一。

## 改动 1：zombie-reaper 叠加 phase-event 心跳判活（cecelia repo，本 PR）

文件：`packages/brain/src/zombie-reaper.js`

- SELECT zombies 时额外取 `payload->>'initiative_id' AS payload_initiative_id`。
- `assessTaskLiveness` 判 `verdict='dead'` 后、进入 onStale 处置前，插入第二判活信号：

```sql
SELECT GREATEST(COALESCE(MAX(ts),0), COALESCE(MAX(ts_end),0)) AS last_hb
FROM initiative_run_events
WHERE initiative_id = $1::uuid
```

- `$1 = payload_initiative_id || task.id`（镜像 harness-skill-relay.js:71 的 fallback，Research 修正 1）。
- `(now_epoch - last_hb) < idleMinutes*60` → 心跳新鲜 → 跳过不杀（log `phase-event heartbeat fresh`）。
- 心跳查询自身出错或无行（last_hb=0）→ 视为无心跳，走原处置逻辑；错误只 console.warn，不进 result.errors、不 fail-open 整个 reaper。
- 先叠加不替换：updated_at 判据保留（addendum-01 关键决策）。

覆盖路径：onStale='fail'（brain-local）与 'release-claim-and-alert'（headed-session）两条处置分支都被心跳守卫保护。relay-container 的 'reignite' 本就落在"其他分支跳过"，不受影响。

## 改动 2：harness-controller 阶段自报 phase-event（zenithjoy-skills repo，独立 PR）

文件：`~/perfect21/zenithjoy-skills/harness-controller/SKILL.md`，版本 1.1.0 → 1.2.0

新增「phase-event 自报（每阶段硬性动作）」节，并在 Step 1-7 各阶段引用：

- 派 subagent 前：
  `EVT_ID=$(curl -s -X POST "$BRAIN/api/brain/harness/phase-event" -H "Content-Type: application/json" -d "{\"initiative_id\":\"$HARNESS_INITIATIVE_ID\",\"node\":\"<阶段名>\",\"status\":\"running\",\"model\":\"<模型档>\"}" | jq -r .id)`
- subagent 返回后：
  `curl -s -X PATCH "$BRAIN/api/brain/harness/phase-event/$EVT_ID" -H "Content-Type: application/json" -d "{\"status\":\"done\",\"ts_end\":$(date +%s),\"cost_usd\":<如可得>}"`（失败时 status=failed）
- 节点名对齐既有枚举：planner / proposer / reviewer / generator / evaluator / judge / merge / report。
- HARNESS_INITIATIVE_ID 缺失（前台手跑未注入）→ 跳过自报不报错。
- BRAIN 变量已在 Step 0 定义（容器内 host.docker.internal:5221 由 Brain 注入 BRAIN_URL）。

合并顺序：skill PR 可先合（写入方）；brain PR 独立（读取方），互不阻塞。

## 测试策略

- **单测（integration 档，vitest mock pool）**：`packages/brain/src/__tests__/zombie-reaper.test.js`
  - 新增 failing test：executor_kind='brain-local'、updated_at 过期、assessTaskLiveness=dead，但心跳 SELECT 返回新鲜 last_hb → 不 UPDATE、reaped=0（Research 修正 2：必须用会走到处置分支的 kind，不用 relay-container）。
  - 新增：心跳过期/无行 → 照常 reap（回归原行为）。
  - 新增：心跳查询抛错 → 照常 reap，不进 result.errors。
  - 新增：payload_initiative_id 存在时心跳查询用它而非 task.id。
  - 适配既有 (a)(e)(f)：dead 任务处置前多一次心跳 SELECT，mock 序列与 toHaveBeenCalledTimes 相应 +1/每 dead 任务。
- **skill 侧**：markdown 指令无单测，靠下一次 harness relay 实跑验证 initiative_run_events 有新行（哨兵见下）。

## 哨兵（回归守卫）

- 逻辑接缝：上述 vitest 回归测试永久留 CI。
- 环境接缝（phase-event 真的有人写）：属 T7 验收后续观察项——下一条 harness relay run 后查 `initiative_run_events` 有当日行即 proven-to-fire；若需机械化，由九要素 T1 账本保鲜守卫（ledger-hygiene tick）覆盖"表 X 天零写入"告警，不在本 PR 重复建。

## Follow-up（不在本次范围，Research 修正 3）

- `alertness/healing.js restartStuckExecutors`（30min requeue）与 `tick-helpers.js autoFailTimedOutTasks` 是平行处置路径，后续若再现"updated_at 过期但实际在跑"误杀，应把心跳第二信号同样接入这两处。
