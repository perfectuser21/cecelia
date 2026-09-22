# 设计：秋米中文 GTD 表接入 Brain 统一调度 + Jev 路由派发

Brain task `15f42776`（interactive_dev_path_a）· 决策 `b8abd28c` · Journey F6 收件箱归位（824ee0f5）· Ability `228e77c0`
需求真身：`sprints/09221827-qiumi-task-router/prep-prd.md`（15 条硬约束、三方映射表、判定点表、验收标准，本文不重复）

## 0. 结论与切法

一句话：**人从 Notion 进，机器从 Brain 进，Notion 永远是投影**。中文 GTD 表不再直连 OpenClaw；Brain 是唯一协调者，Jev 只是派发前的判定器，OpenClaw 只是执行工具。

三个顺序 PR，每刀独立可验、可回滚；旧 us-vps cron（`*/3` notion-qiumi-delegate.py）一直运行到 PR3 切换：

| 刀 | 范围 | 行为变化 |
|---|---|---|
| **PR1 地基** | 迁移 461；任务类型注册表 + 22 处替换 + 机械守卫；转移表 `in_progress→completed_no_pr`；终态清认领；`openclaw-agent` executor 合同 | 对现有任务零行为变化（注册表派生集合与现值逐一相等，有测试断言） |
| **PR2 入口** | 中文↔英文双向同步 job；`qiumi_task` 经 pullNotionTasks 直落 queued；租户/优先级/due_at 映射；状态回写独立通道；两条人工急停 | 只对带 `[zh:]`/`[en:]` 标记的行生效；未标记行行为不变 |
| **PR3 路由执行** | 派发前路由（便宜闸→Jev）；设备任务转 device_job；Brain 经 ssh 在 MMV 起 `openclaw agent`；收割回写；切旧 cron | 切换脚本受守卫保护，在途清零才切 |

## 1. 组件与边界

### 1.1 任务类型注册表（PR1）`packages/brain/src/lib/task-type-registry.js`
唯一来源（铁律 76cb816c）。每个 task_type 一行声明：
```
{ execution_surface: 'kernel'|'openclaw-agent'|'device'|'brain-internal'|'external',
  is_coding_mutation, produces_pr, executor_kind, watchdog: 'kernel'|'external-worker'|'openclaw-agent'|'none',
  push_to_notion, tick_dispatchable, cleanup_class }
```
导出派生集合：`TICK_BLACKLIST`、`PUSH_EXCLUDED`、`CODING_MUTATION`、`EXECUTOR_KIND_FOR`、`VALID_TASK_TYPES`…。研究报告列出的 22 处（派发 9 / 推送 3 / 看门狗 4 / 清理 6）改为 import 派生集合；`task-router.js:16`、`routes/task-tasks.js:27`、`executor-contracts.js:36-55` 必在其中。
守卫：`__tests__/task-type-registry.guard.test.js` — ① grep `packages/brain/src` 中任何 `task_type (NOT )?IN \(` 字面量名单，白名单只有注册表文件本身，命中即红；② 派生集合与迁移 457/461 的 DB 白名单一致；③ 变异：临时删一处 import 必红（测试内用 fixture 复制再删验证）。
`qiumi_task` 声明：`openclaw-agent` 面、非编码、不产 PR、executor_kind `openclaw-agent`、push_to_notion=true（走 zh 通道）、tick_dispatchable=true（PR3 前 PR1/PR2 期间由 `payload.headed_manual=true` 谓词挡住，避免 tick 抢跑）。

### 1.2 迁移 461+462（PR1）`migrations/461_qiumi_task_type_tenant_dedup.sql` + `migrations/462_validate_task_type_check.sql`
- `tasks_task_type_check`：照 457 写法（DROP + 全量重建，列表取生产 `pg_get_constraintdef` + `'qiumi_task'`），461 内用 `NOT VALID`（目录项登记，毫秒级，不扫存量行）；存量行验证拆到独立文件 462 的 `VALIDATE CONSTRAINT`（终审 I1：SHARE UPDATE EXCLUSIVE 锁不阻塞并发 DML，且与 461 的 ACCESS EXCLUSIVE 重活分处两个事务，tasks 高频写表不被长事务挡）。
- `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id TEXT`；回填 `payload->>'tenant_id'`（分批循环，5000/批，控制单条语句体量）；索引 `(tenant_id, status)`。
- `idx_tasks_dedup_active` 重建：谓词追加 `AND COALESCE(payload->>'dedup_by_notion_page','false') <> 'true'`。**不能用 `notion_id` 列**：createRoutedTask 的 INSERT 不含 notion_id（`work-routing-store.js:308-318`），页 id 是建单后才 UPDATE 上去的，插入瞬间仍为 NULL 照样撞；且 pushTasks 给所有投影任务都写 notion_id（`notion-push-sync.js:280`），拿它豁免会让全部已投影活跃任务失去去重。**也不能用 `payload.notion_page_id`**：现有 `pullNotionTasks`（`notion-push-sync.js:403` `source='notion_tasks_db'`）建单时已经把 `metadata:{notion_page_id: page.id}` 传给 `createRoutedTask`，`work-routing-store.js` 的 `payload = {...request.metadata, ...task.payload}`（`:213`）在 INSERT（`:308-318`）时把 metadata 整体 spread 进 payload——生产里**现在**就有活跃任务的 payload 带 `notion_page_id`，拿它当豁免键会让全部既有 Notion 排单任务立刻退出 title 去重，属真实行为变化。豁免键改用专用的 `payload.dedup_by_notion_page='true'`，只有 PR2 的 `qiumi_task` 建单路径会显式写它，INSERT 时即带，同名行插入即不撞。PR1 只改谓词，此时无任何任务带该键，行为不变。

### 1.3 状态机（PR1）`lib/task-status-transitions.js`
- `in_progress: ['completed','completed_no_pr','failed']`；`WAITING_EXITS` 加 `completed_no_pr`。
- `routes/tasks.js:522` 终态清 `claimed_by/claimed_at` 补 `completed_no_pr`。
- 完成硬闸（`tasks.js:471`）不动：它只在 `status==='completed'` 分支触发，非编码类型走 `completed_no_pr` 天然不进 PR 闸；防误用断言**只对 `execution_surface='openclaw-agent'`（即 qiumi_task）生效**：PATCH `completed` → 409 提示改用 `completed_no_pr`。不得扩到全部 `produces_pr=false` 类型——talk/research/data/content-* 等存量类型今天 PATCH completed 合法（闸只查 review_required/pr_url，`tasks.js:471-495`；转移表对所有类型开放 `:62`），一刀切会改变现有行为。
- 今后只写 `cancelled`；读认两拼写（现状已如此）。

### 1.4 执行体合同（PR1）`executor-contracts.js`
新增 `openclaw-agent`：probe = ssh `us-mac-m4` 执行 `test -f ~/brain-runs/<run_id>.exit && cat 或 kill -0 <pid>`；`staleMinutes=45`（AGENT_TIMEOUT 1800s + 余量）；`onStale='fail'`（守护刀只认 `fail`/`requeue`/`release-claim-and-alert`，`zombie-reaper.js:118,133`、`alertness/healing.js:641,649`；与 brain-local 同款 `executor-contracts.js:138-139`，未知值会让僵尸永远不被清）。`EXECUTOR_KIND_FOR.qiumi_task='openclaw-agent'`。`tick-runner.js:1314` 清理白名单不加（不清）。

### 1.5 中文↔英文同步（PR2）`packages/brain/src/notion-gtd-sync.js`
挂 `scheduler-jobs` 新 job `notion-gtd-sync`（60s 轮询 + handler 内自跑两轮/30s，受 timeoutMs 约束）；env 开关 `QIUMI_SYNC_ENABLED`。
- **正向 zh→en**：查中文表 `状态=委派 ∧ OpenClaw任务号为空 ∧ 归档=false`，逐行在英文库建行：Name=标题、Description 前缀标记 `[zh:<页id32>]` + 备注 + 正文全文、Status=Delegated、Plan Date=预期完成日期；写回中文行 `OpenClaw任务号=en:<英文页id32>`（占位防重复）。
- **pullNotionTasks 改造**（`notion-push-sync.js:339-441`）：Description 含 `[zh:]` 或 `[en-native]` 标记 → `requested_task_type='qiumi_task'`、`mutation_intent='none'`、`declared_domain='operations'`、`payload.tenant_id` 由 `NOTION_TENANT_MAP`（DB id→租户，env JSON；中文表→`yueshengyun`）、`priority` 由中文「优先级」（P0-P3 映射，缺省 P2）、`due_at` 由 Plan Date、`payload.headed_manual=true`（PR3 前）、`payload.notion_page_id`、`payload.dedup_by_notion_page='true'`（去重豁免键，INSERT 时即带；见 1.2 节——不能复用 `notion_page_id` 本身，存量任务已带该键）、`payload.notion_zh_page_id`、`task.trigger_source='manual'`（显式，硬约束 6；默认 `source='inbox'` 虽不在 SYSTEM_AUTO 名单但不靠默认）；**直落 queued，不落 blocked**（原 `:412` 的 blocked 仅对非 qiumi 保持）。建单成功后中文行 `OpenClaw任务号=brain:<id>`、状态「进行中」。
- **反向 en→zh**：英文库 `Status=Delegated ∧ Description 不含 [zh:] ∧ 不含 brain:`（原生行）→ 在中文表建行（备注写 `[en:<页id32>]`，状态「进行中」，任务号 `brain:<id>` 在入账后回填）；英文行 Description 追加 `[en-native]`，防再反向。
- **状态回写 zh 通道** `pushZhTasks`：查 `tasks.notion_id IS NOT NULL ∧ payload.notion_zh_page_id IS NOT NULL ∧ 状态自上次推送变化`（`notion_props.zh_pushed_status`），按三方映射表写中文行；每轮 ≤50；等待态写「进行中」+ `OpenClaw结果=[等待中:<reason>]`；失败态写「推迟」+ 清任务号 + 原因；终态写「已完成」+勾选+完成日期+结果（`result.receipt`）。映射表是显式对象，测试断言 Brain 15 态每个都在表里（未列出=不同步，且不允许缺项）。
- **急停**：查中文表 `OpenClaw任务号 like 'brain:%' ∧ 状态∈{淘汰,阻塞,委派}`：淘汰→PATCH `cancelled`；阻塞→`paused`；委派（且 Brain 现为 paused）→`queued`。只对任务号非空行生效（归属铁律）。
- Notion 请求：在 `notionReq` 外包 `withBackoff`（429/5xx 指数退避 4 次），不丢单。
- 与旧脚本并存（PR2 期间）：旧脚本只认 `OpenClaw任务号为空` 的委派行，新 job 认领时先写 `en:` 占位，谁先写谁赢，不会双跑；切换在 PR3。

### 1.6 路由与执行（PR3）
- `packages/brain/src/routing/qiumi-router.js`，插在 `dispatcher.js:692` `applyDispatchAllocationGuide` 之前，只对 `task_type='qiumi_task'`：
  1. 便宜闸（6eb0dff5）：relation/执行通道字段（PR2 已随 `[zh:]` 元数据带入 payload）→ 硬约束；注册表匹配：正文/备注命中 `ops_agents`/手机 registry 序列号或账号名、`ops_workflows` 名 → `is_device=true`；
  2. 未命中 → `jev-client.js`：`POST https://api.typesafe.ai/v1/systemone`，questions {engine: choice[claude,codex,terra], is_device: noul, account: choice[registry 池]}，state=标题+备注+全文（key/token/password 模式打码），`AbortSignal.timeout(3000)` 重试 1 次 → 失败转 `llm-caller` terra 20s 重试 1 次 → 仍失败返回 `{decision:'fail'}`；
  3. 结果：`is_device` 或 `confidence<0.8` → 事务内改 `task_type='device_job'`、写 `payload.serial/assigned_to`（来自注册表命中）、`trigger_source='manual'`、`headed_manual=true`，交给现有领单器（有锁）；判不清 → `failed` + `error_message` 原因（中文表「推迟」）；非设备 → `payload.model=<engine→模型 id 查表>`、`payload.provider`，`account` 只允许 registry 池内值；
  4. 每步写 `task_events` 留痕（0f8309e8）。
- `openclaw-agent-executor.js`：在 dispatcher spawn 分支按 `execution_surface='openclaw-agent'` 走：`execFile('ssh', [...SSH_BASE_ARGS, sshTargetFor('us-mac-m4'), 'M=$(cat); nohup ... openclaw agent --agent <a> --model <m> --session-key agent:<a>:notion-delegate-<task_id> --message "$M" --timeout 1800 --json > ~/brain-runs/<run_id>.log 2>&1; echo $? > ~/brain-runs/<run_id>.exit'])`，prompt 走 stdin（不拼命令行）；MMV 并发闸：查 `tasks` 中 `executor_kind='openclaw-agent' ∧ in_progress` 计数 ≥2 → 本轮跳过。
- 收割：复用 `reapSshWorkflowRuns` 模式新增 `reapOpenclawAgentRuns`：`.exit` 存在 → 0 → `completed_no_pr` + `result.receipt={exit,log_tail,finalAssistantVisibleText}`；非 0 → `failed` + 原因。
- 切换：`scripts/ops/qiumi-cutover.sh`（幂等）：① 注释 us-vps `*/3` 行；② 等旧脚本在途（中文表 `OpenClaw任务号` 非 `brain:`/`en:` 前缀且状态进行中）清零；③ 置 `QIUMI_SYNC_ENABLED=true` 并去掉 `headed_manual` 谓词依赖；④ 更新 `ops_schedule_entries`。守卫：新 job 拒认领任务号非空行（变异测试）。

## 2. 数据流（PR3 全部落地后）
中文行「委派」→(30s) 英文行 `[zh:]` →(≤60s) `qiumi_task queued(tenant,priority,due_at)` → tick 选中 → 路由（便宜闸/Jev）→ device_job（领单器/设备锁）或 ssh MMV openclaw agent → `.exit` 收割 → `completed_no_pr`/`failed` → zh 通道回写中文行 → 主理人可随时拖淘汰/阻塞急停。

## 3. 错误处理
| 依赖 | 失败 | 处理 |
|---|---|---|
| Notion API | 429/5xx | 指数退避 4 次；仍失败本轮跳过、下轮重试；不清占位 |
| Jev | 超时/非 200 | 重试 1 次→terra→重试 1 次→failed+原因；绝不跳过判定执行 |
| 设备判定 | 置信 <0.8 | failed+「推迟」写原因，不派 |
| ssh/MMV 网关 | 断/pending approval | 派发重试 1 次→failed；收割阶段以 `.exit` 缺失+staleMinutes 判死 |
| 双写冲突 | 中文 vs Brain | 内容/急停中文赢，执行状态 Brain 赢（字段分域，不比时间戳） |
| 同名任务 | title 撞索引 | `notion_id IS NOT NULL` 豁免 |
| tick 抢跑（PR1/PR2 窗口） | qiumi_task 被 kernel 跑 | `headed_manual=true` 谓词 + 注册表 `tick_dispatchable` 双闸 |

## 4. 测试策略
| 档 | 内容 | 位置 |
|---|---|---|
| E2E（真库 smoke，cecelia_test） | 中文行→英文行→Brain 任务→（stub ssh）→`.exit`→completed_no_pr→中文行已完成；同名两行各自入账；急停三态；归档/收集/下一个行动不入账；切换守卫变异 | `scripts/smoke/qiumi-task-router-smoke.sh`（登记 `packages/quality/smoke-allowlist.txt`） |
| integration（vitest+pg） | 迁移 461 前后 CHECK/索引/tenant 列；转移表入边与 522 清认领；注册表派生集合==现值；pullNotionTasks 分支（fetch stub） | `__tests__/*.test.js` |
| unit | 路由决策表（便宜闸优先级、阈值、池外账号拒绝）；jev-client 兜底阶梯（fake timers）；三方映射表完整性；withBackoff | 同上 |
| trivial | env 常量、模型 id 映射表 | 无需测 |
守卫全部变异测试（feedback_mutation_test_the_guard）：注册表 grep 守卫删 import 必红；切换守卫伪造在途必红；映射表删一行必红。

## 5. 配置
容器 env（改了必须重建容器，learning cp-0916213853）：`JEV_API_KEY`（1Password「Jev API Key (TypeSafe)」→ us-vps env，848aeef2）、`JEV_ENDPOINT`、`QIUMI_SYNC_ENABLED`、`NOTION_GTD_DB_ID=c69c40c2-…`、`NOTION_TASKS_DB_ID=d5bc40c2-…`、`NOTION_TENANT_MAP='{"c69c40c2-…":"yueshengyun"}'`、`QIUMI_MMV_CONCURRENCY=2`。

## 6. 不做
296 条无 TTL blocked 积压；pullNotionTasks 非 qiumi 路径的"落地即 blocked"；OpenClaw 19 个 cron / harvest 进 Brain；web 前台入口；Grok 入模型目录。
