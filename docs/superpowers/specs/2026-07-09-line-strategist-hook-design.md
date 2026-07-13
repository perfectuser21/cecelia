# Line 军师终态接线 + 两处工程收尾 — 设计文档

日期：2026-07-09
关联 PrepPRD：`sprints/07091729-line-strategist-hook/prep-prd.md`
关联 Journey：Cecelia Harness Pipeline（`bb8cc561-b3ee-4fec-b74d-2255694bd963`）
前置：T2（bd0478b7，ability_id 全链接线，已合并 cecelia#3667）

## 背景

`line-strategist` skill（`zenithjoy-skills/line-strategist`）已 ship，期望被 Brain 以
`task_type=strategist_decision` 派发，运行时从环境变量读取 `LINE_ID`(journey_id)/`TRIGGER`/
`TRIGGER_CONTEXT`。但目前：
1. Brain 没有任何机制在 task 落终态（completed/failed）时创建这类任务；
2. `strategist_decision` 还未注册进 `task-router.js` 的路由三张表，派发会被拒；
3. `advancement_items` 表缺 `journey_id` 列，`ability_id` 是 `NOT NULL`，无法表达"推进项挂纯
   line 层级、暂未绑定 ability"的场景；
4. Bark 告警 token 未透传进 Brain 容器，`notifier.js` 的 Bark 推送分支在生产容器内永远静默失败。

## 架构决策：轮询式钩子而非侵入式改写状态写入点

调研发现 task 终态写入分散在至少 6 个文件（`task-updater.js`/`executor.js`/
`harness-relay-watchdog.js`/`monitor-loop.js`/`crystallize-orchestrator.js` 等），多数走原始
SQL `UPDATE tasks SET status='completed'...`，并不经过 `task-updater.js` 唯一入口。

**拒绝方案**：在每个写入点插入钩子调用——改动面大、遗漏风险高（新增写入点会静默漏挂）。

**采用方案**：新增一个 tick 周期模块（复用现有 `tick-runner.js` 的"每个关注点一个
`run<X>IfNeeded()` 文件"惯例，参见 `diary-scheduler.js`/`memory-sync.js` 等同构写法），
按轮询方式扫描新落终态的任务，按 journey_id 分组派发，与写入点解耦、覆盖所有来源。

## 组件设计

### 1. `packages/brain/src/line-strategist-dispatcher.js`（新文件）

导出 `dispatchStrategistDecisionsIfNeeded()`，被 `tick-runner.js` 的 `executeTick()` 调用。

逻辑：
```
1. 查询：SELECT id, payload->>'journey_id' AS journey_id, status FROM tasks
          WHERE status IN ('completed','failed')
            AND payload->>'journey_id' IS NOT NULL
            AND updated_at > NOW() - INTERVAL '10 minutes'   -- 只看近期窗口，避免全表扫描
            AND NOT (payload ? 'strategist_dispatched')       -- 用 payload 标记位去重，防止同一
                                                                 终态任务被重复处理
2. 按 journey_id 分组
3. 对每个 journey_id：
   a. 查重：SELECT 1 FROM tasks WHERE status='queued' AND task_type='strategist_decision'
             AND payload->>'journey_id' = $1  LIMIT 1
      → 存在则跳过（防抖去重，同一 line 不重复排队）
   b. 不存在则 POST 新任务：
      task_type='strategist_decision', payload={journey_id, trigger:'run_terminal',
      trigger_context:{terminal_task_ids:[...]}}
4. 把本轮处理过的 task id 标记 payload.strategist_dispatched=true（无论 3a 是查重跳过还是新建，
   都要标记——否则同一 line 短窗口内每个 tick 都会重新触发查重判断，虽然不会重复建任务，但会有
   无谓查询；标记后同一批终态任务只处理一次）
```

`journey_id` 字段现状已确认：`tasks` 表本身**没有** `journey_id` 列（只有 `ability_id` 外键指向
`journey_features`），所有 journey 归属信息走 `payload->>'journey_id'` 携带（T3 自身任务即是此模式）。
上面的 SQL 已按此现状编写，不使用真实列，全部走 `payload` JSONB 路径查询。

### 2. `packages/brain/src/task-router.js` 路由注册

三处新增：
- `VALID_TASK_TYPES`：加入 `'strategist_decision'`
- `SKILL_WHITELIST`：`'strategist_decision': '/line-strategist'`
- `LOCATION_MAP`：`'strategist_decision': 'us'`
- `TASK_REQUIREMENTS`：`'strategist_decision': ['has_git']`（skill 需要读 git 历史/decisions API）

### 3. Migration 325：`advancement_items` 表结构调整

```sql
ALTER TABLE advancement_items ADD COLUMN journey_id UUID REFERENCES journeys(id);
ALTER TABLE advancement_items ALTER COLUMN ability_id DROP NOT NULL;
```

### 4. Bark token 容器 env 透传

`docker-compose.yml` 的 `node-brain.environment` 仿照 `FEISHU_BOT_WEBHOOK` 写法追加：
```yaml
- BARK_TOKEN=${BARK_TOKEN:-}
```
`.env.docker.example` 追加一节：
```
# === Bark 告警推送 ===
# 源：1Password CS Vault "Bark" 条目 → ~/.credentials/bark.env
BARK_TOKEN=your-bark-device-token
```
实际 `.env.docker`（不进 git）需人工/部署脚本从 `~/.credentials/bark.env` 补值——这一步是部署时
操作，不在本次代码改动范围内，验收标准只验证「代码链路透传正确」，真实值注入由
`brain-deploy.sh` 部署时环境变量展开完成。

## 数据流

```
task 终态(completed/failed) 写入(任意来源)
   → tick 轮询(line-strategist-dispatcher.js, 10分钟窗口)
   → 按 journey_id 分组 + 查重
   → POST /api/brain/tasks {task_type:'strategist_decision', payload:{journey_id,...}}
   → task-router 路由(us, /line-strategist, has_git)
   → line-strategist skill 消费 LINE_ID/TRIGGER env 执行
```

## 错误处理

- 查询窗口内数据库查询失败：捕获异常，log warning，本轮跳过，下一 tick 重试（不阻塞其他 tick 任务，遵循现有 `run<X>IfNeeded` 模块统一 try/catch 惯例）。
- 创建新任务的 POST 失败（Brain API 内部调用，实际是直接调用 `insertTask`/pool.query，非跨进程 HTTP）：记录 error，不标记 `strategist_dispatched`，允许下一 tick 重试创建。
- journey_id 为 NULL 的终态任务：直接跳过，不产生 strategist_decision（无 line 归属无法派发）。

## 测试策略

- **Unit**：`line-strategist-dispatcher.test.js` — mock pool，覆盖：①有新终态任务且无重复排队 → 建新任务 ②已有同 journey_id 排队任务 → 跳过 ③journey_id 为 null → 跳过 ④已标记 dispatched 的任务不重复处理。
- **Unit**：`task-router.test.js` 追加断言 `strategist_decision` 在三张表中都存在且值一致。
- **Integration**：migration 325 apply 后查 `information_schema.columns` 确认 `journey_id` 列存在且 `ability_id` nullable。
- **Manual（CI 兼容）**：`grep -c "BARK_TOKEN" docker-compose.yml` 断言 ≥1。

## 已知限制（非阻塞，留作后续 follow-up）

10 分钟扫描窗口没有补扫机制：若 Brain 停机超过 10 分钟后重启，期间落终态且 `updated_at` 已滑出
窗口的任务会被永久跳过，不会产生 `strategist_decision` 也不会重试。本 PR 不解决（Brain 正常运行
下停机超 10 分钟是罕见故障场景，不阻塞本次交付），后续可考虑加一个更长周期的补扫 job 或记录
`last_scanned_at` 游标替代滑动窗口。

## 不包含

- decomp + decomp-check 合并（已拆分为独立 skill-creator 任务 `bd73035a`）
- Bark token 实际值注入生产 `.env.docker`（部署时操作，非代码改动）
- `line-strategist` skill 本身逻辑修改（消费方不变）
