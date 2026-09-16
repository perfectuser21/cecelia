# 开工交接单：OpenClaw 任务回填 Cecelia tasks 账（新会话直接照做）

**状态**：立项完成、现场已勘测、方案已定，**未写一行代码**。新会话接手即可开工。
**上游**：主理人 2026-09-16 要求「群里给 agent 布置的任务，每天回填到 Cecelia task database / Notion」。
**前序交接单**：`docs/handoffs/202609161350-conversation-task-ledger.md`（背景与路径确认）

---

## 一、结论先行：不用做对话理解，OpenClaw 已有结构化任务账

原以为要从对话流里提炼任务（难、不准）。**实勘发现 OpenClaw 自己有 `task_runs` 表，1879 行，字段齐全**——归集腿只是「读它 → 转成 Cecelia tasks 行」，纯搬运，零 AI 判断。

## 二、数据源（已验证可读）

| 项 | 值 |
|---|---|
| 库文件 | 宿主 `/opt/openclaw/state/state/openclaw.sqlite`（229MB） |
| Brain 容器内路径 | **同上**（compose 已挂 `/opt/openclaw/state`，PR #5346） |
| 读取方式 | **无 sqlite3 CLI**（宿主和两个容器都没有）→ 用 Node 内置 `node:sqlite`，`new DatabaseSync(path,{readOnly:true})`，跑时加 `--no-warnings`（实验特性会刷 warning） |
| 铁律 | **只读打开**。这是 OpenClaw 的库，写它=污染第三方状态 |

### `task_runs` 表字段（实测）
```
task_id, runtime, task_kind, source_id, requester_session_key, owner_key,
scope_kind, child_session_key, parent_flow_id, parent_task_id, agent_id,
requester_agent_id, run_id, label, task, status, delivery_status, notify_policy,
created_at, started_at, ended_at, last_event_at, cleanup_after,
tool_use_count, last_tool_name, error, progress_summary,
terminal_summary, terminal_outcome, detail_json
```

### ⚠️ 坑（实测踩过，别再踩）
1. **`created_at` 是毫秒时间戳**（如 `1789539055639`），不是 datetime 字符串。用 `datetime('now','-1 day')` 比较**恒返回 0 行**——必须 `created_at > (unixepoch()*1000 - 86400000)` 或在 JS 侧算
2. 同库还有个同名旧文件 `/opt/openclaw/state/backups/.../openclaw.sqlite`（备份，别读错）
3. `/opt/openclaw/state/openclaw.sqlite` 路径**不存在**，真路径多一层 `state/`

### 口径（实测 kind 分布：automation_run 1012 / null 506 / exec 361）
| task_kind | 含义 | 是否回填 |
|---|---|---|
| `null` | **人派的活**（样本：「处理 OPC 经营对象…KR1.2 核验」）| ✅ **本单正题，必填** |
| `automation_run` | cron 定时（值守/同步/heartbeat）| 建议填（机器自主动作留账，决策 2dbabb48），可二期 |
| `exec` | CLI 命令（`Background CLI command`）| ❌ 噪音，不填 |

## 三、实现方案

**位置**：`packages/brain/src/openclaw-guards.js` 加第六腿，或独立 `openclaw-taskruns-ledger.js` 挂 scheduler（推荐独立，职责清晰）。频率：每日一次或每小时增量。

**入账**（走正规账房，禁直接 INSERT INTO tasks——有 task-creation-inventory 守卫）：
```js
await createRoutedTask(pool, {
  source: 'inbox',                    // 枚举内，别造新值（会被 work-router 拒）
  source_id: row.run_id,              // 幂等键：同 run 重放拿回同一 task
  title: row.label || row.task?.slice(0, 80),
  description: row.task,
  mutation_intent: 'none',            // 必填！缺了报 invalid
  declared_domain: 'operations',      // 走非编码路线，不解析 repo/branch
  requested_task_type: 'workflow_run' // 已在 task_type 枚举内（migration 446）
  metadata: { openclaw_run_id, agent_id, task_kind, channel/群 id（从 detail_json 取） },
  task: { status: <映射>, priority: 'P2' },
});
```
**状态映射**：`succeeded→completed`、`failed/timed_out→failed`、其余→completed（事后账，不建 in_progress 僵尸）。

**投影**：入账后既有 `pushTasks`（notion-push-sync.js）自动推 Notion Tasks 库，主理人在同一张表看全「人排的 + 机器干的」。**无需额外开发**。

**新 task_creation-inventory 条目**：新模块要在 `task-creation-inventory.js` 登记一行，否则 CI 守卫红。

## 四、验收标准（Final E2E，禁「测试通过」空话）
- [ ] 跑一次归集后，`SELECT count(*) FROM tasks WHERE payload->>'openclaw_run_id' IS NOT NULL` > 0
- [ ] 抽一条比对：Cecelia task 的 title/description/status 与 sqlite 里同 run_id 那行一致
- [ ] 重复跑两次，计数不翻倍（幂等真生效）
- [ ] Notion Tasks 库能查到这些行（API 读回验证，非"应该会推"）
- [ ] `exec` 类未入账（噪音过滤生效）

## 五、开工前必做
1. `POST localhost:5221/api/brain/tasks` 注册任务 → `/dev --task-id` 立刻 claim（防 tick 抢跑）
2. 部署走 MMV 交叉构建 SOP（memory `usvps-image-build-via-mmv`：`--platform linux/amd64` + save/load，先验后删旧镜像）

## 六、同族待办（本单外，按需）
- 触达 tick / 判定 cron 的 run 入账（automation_run 那半边）
- **跑场机会话回收**：MMV 上 codex app-server 不自退（最老 5h40m，49 进程 743MB，当前无害但只增不减）→ 加「>12h 无活动单杀」守卫
- **触达线仍空转**：飞书话术表 A1/A2/B「启用状态」全停用（09-15 12:02 起），守卫每轮告警，需主理人在飞书启用

## 七、关键坐标
- 账房：`packages/brain/src/work-routing-store.js` createRoutedTask
- 投影：`packages/brain/src/notion-push-sync.js` pushTasks
- 守卫参考实现：`packages/brain/src/openclaw-guards.js`（五腿模式，纯函数内核+注入 IO 可测）
- 注册点：`packages/brain/src/scheduler-jobs.js`
- 决策：2dbabb48（一切执行进账/真相源分层）、95477a66（us-vps 零执行）
