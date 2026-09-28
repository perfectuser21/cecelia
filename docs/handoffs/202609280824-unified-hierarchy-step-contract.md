# Handoff：统一层级 + 步骤契约 + 智能获客实查（session 045ab151，2026-09-27~28）

> 新 session 开场先读本文件，再读两条决策：`curl localhost:5221/api/brain/strategic-decisions?limit=50` 找 `9d5fce74`、`3240824c`。
> 下一步主线：**继续和主理人讨论命名方式**（第 6 节列了未决点），然后推进第一棒任务 `5b4605eb`。

---

## 1. 起点

主理人贴来一份 Notion AI 写的交接单（Notion ↔ Brain 对账），说 09-26 Notion 重组时误删了 10 个库。本 session 从那里出发，一路追到「概念层级乱」「智能获客失败多」「脚本漂移」，最后定了统一层级和步骤契约两条决策。

---

## 2. 已完成（全部已验证）

| 事项 | 结果 | Brain 任务 |
|---|---|---|
| Notion 误删库恢复 | 映射表登记的 5 个（AI Journey / AI Feature / Ops Skills / Workflows 总库 / AI Golden Path）+ 旧 Cecelia Tasks 共 6 个经 API 恢复；推送「archived ancestor」报错归零，ops_skills 20 行重推成功 | 42038621 ✅ |
| Skill Registry 标签 | Notion 标题去掉「（可删除）」改「🔒 Skill Registry」，描述写明镜子库 | — |
| 本机 Postgres 清理 | 删 21 个测试遗留库，保留 10 个；删前 pg_dump 备份在 `~/db-backups/mmv-cleanup-20260927`（14MB，逐个校验可读） | b242263b ✅ |
| 统一层级写进词表正本 | `packages/workflows/KERNEL_CONTEXT.md` 新增「统一层级」一节，中英双名，PR #5618 已合并 | f1e1cc3f ✅ |
| xian-m1 获客脚本漂移 | batch2.sh / harvest-cron.sh / wall-report.sh 旧版 + 缺 ledger.mjs → 按 zenithjoy-workspace main 补齐，旧文件备份在 xian-m1 `~/bin-harvest/backup-20260928-pre-m1sync`；md5 一致、语法检查过、ledger 冒烟过。**09-28 23:00 悦升批是新版首跑，需看结果** | 2634f2eb ✅ |

**没恢复的 Notion 库**：Cecelia Feature Registry、Cecelia Projects、Archive · Cecelia Dashboard Draft（拿不到 ID）、Journey-Step（从未共享给集成）。都不在映射表，是否恢复由主理人在 Notion 回收站定。

---

## 3. 已定决策

### 3.1 决策 9d5fce74：统一层级（主理人拍板）

```
Area 领域 → Department 部门 → Value Stream 价值流 → Capability 能力 → Backbone Activity 主干活动 → Step 步骤
                                                   ║ 一对一
                                                Workflow 工作流（能力跑起来的样子，共用同一个 key）
```

- 部门 = Notion Areas 的 Sub-Area，只有一套。一个部门可含多条价值流。
- 能力 = 工作流，一对一。清单只列能力；说「怎么实现」才说工作流。
- 执行层：Workflow 工作流 / Agent 数字员工（属于部门，执行活动）/ Skill 技能（被步骤调用；中文禁叫「能力」）/ Run 运行记录 / Work Item 工作项（改进能力的一件事，交 Kernel/Harness）。
- 正本：`packages/workflows/KERNEL_CONTEXT.md` §统一层级（PR #5618）。

### 3.2 决策 3240824c：步骤契约（主理人授权 Claude 定稿）

**完整契约 15 字段挂在主干活动上**（Notion AI 给的 10 项全保留，收紧 3 项，新增 5 项）：

| 组 | 字段 |
|---|---|
| 身份 | ①稳定 key（只增不改）②版本+兼容性（部署按哈希核对）③负责人（部门/数字员工）【新增】 |
| 接口 | ④输入（对象类型+必填字段）⑤输出（创建/修改哪些对象）⑥前置条件 ⑦后置条件（=判定，必须挂可执行探针，默认拦截） |
| 运行 | ⑧执行位置【新增】⑨时长预算+心跳【新增】⑩资源与限额【新增】⑪幂等+去重键 ⑫失败语义（闭集：正常为空/可重试/需人处理/致命；需人处理必须写告警对象） |
| 边界 | ⑬副作用 ⑭调用权限（代码/数字员工/人）⑮模型与成本（仅调大模型的步骤）【新增】 |

**三层输入输出规则**（对照 GitHub Actions Job/Step、Temporal Activity、Step Functions、Dagster）：

| 层 | 成功判定 | 输入输出 |
|---|---|---|
| 主干活动 | 必须：后置条件探针 | 必须：类型化、对外承诺，组装依据 |
| 步骤 | 必须：一条确定性判定 | 只声明读写活动上下文哪些字段；判定通过 = 给活动续租（心跳）+ 续跑检查点 |
| 技能 | 必须 | 必须：类型化（被多处复用，等于函数） |

- 活动判别法：能用业务语言说清它交出了什么对象（预检交出可用设备+账号；发现交出候选视频清单）。
- 步骤若须换机器执行，必须经技能的类型化接口，不得靠 ssh 传临时文件。
- 共用发生在技能层，不是步骤层。
- **平台差异落在步骤层**：抖音/快手同一获客方法 = 同一能力、同一套活动契约，各平台一套步骤实现。
- 前置：先建对象类型表（Account / Device / Keyword / Video / Comment / Lead / OutreachOrder…，Lead 身份 = 平台账号 id）。
- 契约 = 接口，脚本/技能/n8n 节点 = 实现，可多实现 → 编排器可换。
- 闸：无契约的步骤不得进任何工作流。
- 命名坑：我们的 Activity = Temporal/故事地图义，不是 UiPath 的点击级 Activity。

---

## 4. 实查事实（下个 session 别重查）

### 4.1 数据全景
- 算数的 Postgres：us-vps 宿主 `cecelia`（262 表，唯一大脑）+ hk-vps 容器 `zenithjoy / zenithjoy_staging / n8n`。us-vps 另有 zenithjoy-postgres 容器藏一个 13MB `cecelia` 库，疑似残留未查。
- `notion_projection_map` 58 行 = 47 个 Notion 库（镜子 24 / 入口 16 / 真身 8，Projects 两面）。其中 4 行 unmapped（value_streams 等）其实是视图，登记错了。
- 未登记但被写：OpenClaw 在 us-vps 的 cron（`/opt/openclaw/opc-*.py`）直写「OPC 经营对象」「OPC 日报」「Key Results」。
- **ZenithJoy 结构地图已存在**：scope `zenithjoy-workspace` v6 active（09-18，决策 8e25cb0d），6 条价值流 line00/01/02/04/05/11、22 个能力。Notion AI 手建的「Value Streams」库 7 条（AI Private Community / GEO / Mini APP…）是另一套切法，**未裁决**。
- 两个世界零连线：ops_workflows / ops_agents / ops_skills 没有任何列指向能力、价值流、部门；61 个 agent 部门字段全空。

### 4.2 智能获客（关键词获客）真实执行链
- 不是 n8n（Social Leadgen V4 画布 09-14 起关闭；它的触发源 09-07 无痕死亡）。09-14 起 crontab shell 链临时顶上成了正式生产。
- 入口 3 个：xian-m4 / xian-m1 crontab 调 `~/bin-harvest/harvest-cron.sh <profile> <serial> <词单业务> 6 1`（采收，每天 2~3 次）；xian-m4 `outreach-tick.sh`（触达，每 30 分）；launchd `device-job-claimer`（前台一次性派单）。
- 源码：zenithjoy-workspace `services/phone-adb-controller/`（58 文件，两周 81 次提交）；部署清单 `deploy.sh` 46 文件分三台：本机 `~/.openclaw/leadgen-scripts/`（29 JS + 2 SOP）、xian-m4/m1 `~/bin-harvest/` + `~/.local/bin/douyin-phone-adb`。**deploy.sh 是人手跑，无自动触发、无对账**。
- 同一能力有四套阶段名：前台上报 5 个 / 账本 7 个（preflight discovery qualification collection scoring delivery cleanup）/ 旧 n8n 8 个 / 结构地图 4 个。Notion「Workflow 步骤表」获客 27 行分 8 组（1-preflight … 8-cleanup），**形状与决策一致，可作步骤层底稿**，且已有「有确定性判定?」列。
- 探针：`checks/social-keyword-leadgen.yaml` 只有 5 条，只覆盖 delivery/scoring，全是 warn；账本把 qualification/scoring 标 not_in_profile 跳过（但视频判定每批在跑）；触达不在账本。
- 留痕：hk `zenithjoy.worker_tasks`（+ `worker_task_steps`）→ Brain `tasks.device_job` 只读镜像（`apps/api/src/services/brain-device-job-mirror.ts`）；另有本机 workflow-runs WORKER_RESULT 文件、Brain 判定回执。同一次运行记四份。
- 大模型四处：阶段 0 OpenClaw media 陪跑员（GPT-5.6 terra，备用 sol，Codex 订阅；会话里 sol 300 次 vs terra 77 次，疑主模型常失败未核实）/ 视频判定（阿里 qwen-audio ASR + OpenRouter JEV + Gemini 2.5 Flash 复核）/ 评论分级（OpenRouter）/ 出事升级（本机 launchd `com.zenithjoy.escortclaude` 调 `claude -p` account1）。四本账，运行记录里无模型用量。

### 4.3 失败真相
- 采收「失败」≈全是假的：`worker-tasks-service.ts` `LEASE_MS=10 分钟`、只在 wr step 续租，采收主体一跑 1~7 小时无心跳 → sweeper 判 `executor_lost`；日志证实这些批都「批完成 7~42 LEAD + finalize ok」。反过来 completed 里混 0 线索批（auto09270230）。
- **触达真停 4 天**：xian-m4 两个私信账号熔断——jinoshengyuan-work（09-22）、legacy（09-24 11:11，连续 2 次「verified private-message input was not found」）。flag 在 `~jinnuoshengyuan/bin-harvest/state/dm-paused-*.flag`，须人工核查 `~/anomaly-legacy.log` 后删；无告警，outreach-tick 每 30 分空转 requeue。**flag 未替主理人删（防封号）**。
- Brain 镜像漏回写：10 条 hk=failed 但 Brain=queued，前台显示「待跑」。

### 4.4 更正
- 我曾说「本机 zenithjoy 库 = 线索池生产库」——**错**。本机该库线索表近 8 天 0 行；经隧道 15532 的 HK 库 acquisition_leads 停在 07-09。线索落在 PG `zenithjoy.leadgen_videos`（按 harvest_batch）+ 飞书 Bitable 原始评论池；**真实线索池位置与积压量未查清**。
- `~/AI-CHARTER.md` 说 mmv 本机库「不投影不入账」基本属实，但 zenithjoy 库有 api.dev 在用。

---

## 5. 待办任务（Brain）

| 优先级 | 编号 | 内容 |
|---|---|---|
| P0 | 15c9a456 | 触达停摆：核查 anomaly 日志判限流还是改版；熔断即 Bark；恢复条件机械化 |
| P1 | 5b4605eb | **契约第一棒**：对象类型表 + 15 字段 schema + 关键词获客 8 活动契约 + 27 步骤判定 + 无契约闸；验收=对标链接获客只换「视频发现」组装成功 |
| P1 | 1c256257 | 统一层级接线：地图补部门/主干活动两层；ops_workflows/ops_agents 挂能力与部门 |
| P1 | 21299c1d | 获客假失败（租约无心跳）+ 镜像漏回写 + 结果带线索数（任务标题仍写「镜像漏回写」，根因以本文件 4.3 为准） |
| P1 | 9883924e | 防漂移：合并即自动部署或每日三机 md5 对账告警；清 bin-harvest 残留 |
| P1 | 79e14cc5 | notion-push-sync 自愈补「archived ancestor」400 + issues 状态映射缺 Backlog/Done/小写 |
| P2 | db511407 | 退役 scripts/notion-to-brain 的 journeys/features/steps 反向拉取（cron 均未调度） |

建单坑：dev 类必带顶层 `change_kind`、`repo_hint`（完整 URL）、`map_scope_hint`（如 `["G1"]`）；PATCH 必带 status 且只接受 in_progress/completed/completed_no_pr/failed，无法单改 description。

---

## 6. 未决 / 下个 session 要讨论的

### 6.1 命名方式（主线，主理人要继续聊）
1. **Feature / Enabler 挂在哪层**：a340f100 里它们是挂在主干活动上的「特性/使能项」；统一层级里写「步骤分 Feature/Enabler 两种」。有了契约后，是步骤的分类，还是活动的分类？需定。
2. **Department vs Sub-Area**：英文正式名定了 Department，Notion 里仍叫 Sub-Area；Areas 表里还混着炒股、爱好等生活类，不算部门，要不要拆开。
3. **稳定 key 的命名规范**：能力用 snake_case（keyword_acquisition），账本阶段用英文单词（preflight…），步骤 key 还没有规范；Notion 步骤表 Staging 用「1-preflight」带序号——序号该不该进 key（只增不改原则下，序号会变）。
4. **Golden Path 别名**：a340f100 保留为「内部别名」，统一层级后是否彻底退役。
5. **Workflow 名与能力名**：共用 key，但 n8n 画布名、脚本名、Notion 工作流名各不相同，要不要强制同名。
6. **「Activity」撞名**：UiPath 等 RPA 工具的 Activity=点击级，将来接入时如何避免混淆。
7. **Run 与 Task**：device_job 本质是运行记录却放在 tasks 表（决策 e1ec93b2「tasks=唯一真身」），与 task_runs / ops_runs 三处并存，命名和归属要不要收口。

### 6.2 其他待拍板
- 编排器选型：A 大脑调度（推荐）/ B shell + 定义文件 / C 回 n8n。已建议先 B 后 A。
- 能力「成功」口径：建议=新增 ≥1 条有效线索并落池；触达按天单独判定。
- Notion「Value Streams」7 条 vs 地图 6 条 line，以哪套为准（建议地图，7 条产品方向放 Projects/Areas）。
- 4 个未恢复的 Notion 库是否恢复。
- 触达熔断恢复（须先看日志确认账号安全）。

---

## 7. 数据源

- 决策：`9d5fce74`（统一层级）、`3240824c`（步骤契约）、`a340f100`（行业词汇）、`8e25cb0d`（ZJ 地图 v6）、`702949b6`（验证层）
- 正本：`packages/workflows/KERNEL_CONTEXT.md` §统一层级
- 映射表：`notion_projection_map`（us-vps cecelia 库）
- 地图：`map_manifest_versions` / `map_projection_nodes` / `map_projection_edges`（scope cecelia、zenithjoy-workspace）
- 获客：zenithjoy-workspace `services/phone-adb-controller/`（harvest-cron.sh、outreach-tick.sh、deploy.sh、workflow-result.sh、checks/social-keyword-leadgen.yaml）、`apps/api/src/services/worker-tasks-service.ts`、`brain-device-job-mirror.ts`
- Notion：Workflow 步骤表 `3d9c40c2-ba63-8195-a41b-f529056a4aa8`
- Memory：`data-landscape-journey-capability-workflow.md`
