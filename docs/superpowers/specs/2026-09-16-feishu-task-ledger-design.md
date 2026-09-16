# 飞书群交办入账（Feishu Task Ledger）设计

- Brain task: `abcbc09f-d4c9-40db-a6fd-594fce901674`
- 决策：方向 `1c6679cd` / 判定点 `398d5f36`
- PrepPRD：`sprints/09161600-feishu-task-ledger/prep-prd.md`

## 1. 要解决的问题

主理人在飞书群里给 agent（秋米）布置的活，目前不进任何账本——做没做、派了多少，事后无从查证。
目标：每小时把「群里真派给 agent 的活」自动入 Cecelia `tasks` 账，经既有 `pushTasks` 投影到 Notion Tasks 库。

## 2. 为什么不从 OpenClaw 库搬（前序方案作废）

实勘 `/opt/openclaw/state/state/openclaw.sqlite`（229MB，只读打开验证）：

| 前序交接单假设 | 实测 |
|---|---|
| 用 Node 内置 `node:sqlite` 读 | Brain 容器 Node v20.20.2，无该模块（22.5+ 才内置） |
| `task_kind=null` = 人派的活（507 行） | 实为 work-commander workflow 阶段 273 + OPC 心跳 104 + 班会 cron 60 + `reply with just: ok` 探活 55 |
| 群里的活可从 `task_runs` 回填 | 飞书群通道仅 13 行，全是 `Background CLI command` 与 gateway restart 记录，**零条可读任务** |

补充证据：`channel_ingress_events` 396 条飞书事件的 `payload_json` 全为 `"null"`（完成后清空）；
`worker_transcript_commits` / `worker_inference_turns` 均为 0 行；`session_state_events` 中飞书会话 0 条。

**结论：OpenClaw 不持久化群消息原文，唯一可信源是飞书开放平台 API。**

## 3. 数据源

飞书 OpenAPI，使用「秋米」app 凭据（该 app 已在目标群内）：

1. `POST auth/v3/tenant_access_token/internal` → tenant_access_token
2. `GET im/v1/messages?container_id_type=chat&container_id=<chat>&start_time=<ts>&sort_type=ByCreateTimeDesc` → 群消息（原文 / sender / mentions / create_time），分页 `page_token`

群清单来自 OpenClaw `clawdbot.json` → `channels.feishu.accounts.main`，**在本模块内配置化落库**（不在运行时读第三方配置文件）：

| chat_id | 名称 | requireMention |
|---|---|---|
| `oc_ee3fe04cf2541c4187f0fc054ae826de` | 悦升云端 | true |
| `oc_ef60d6e3f199d90dd695b6ecc213d662` | VPS 状态 | false |
| `oc_e5ff09de4c2e30a332df0d3cf87f41ae` | 外部Ai体验区 | true |

## 4. 三道判据（主理人拍板）

### 判据 1 — @ 的必须是秋米（机械，纯函数）
实测 14 天 232 条带 @ 的人发消息中，被 @ 对象为：徐啸 101 / **秋米 81** / 于瑾 29 / 苏彦卿 23。
`requireMention=true` 的群：`mentions[].name === '秋米'` 才入候选；`false` 的群：所有 `sender_type==='user'` 消息入候选。

### 判据 2 — 秋米能即答、没调 agent 干活的不算任务（语义，LLM）
分类四档，仅 `task` 入账：

| 类别 | 判据 | 样本 |
|---|---|---|
| `task` | 要求 agent 执行动作并产出结果 | 「帮我建三个飞书文档：公司信息/产品信息/目标人群」「把抖音读昵称沉淀成 Skill」 |
| `question` | 索取信息 | 「表在哪」「现在的模型是什么」 |
| `debug_paste` | 粘贴报错/终端输出求解释 | 大段 `ERROR: Could not find a version...` |
| `chat` | 状态告知/闲聊 | 「授权成功了」「在吗？」 |

规则法已否决：「你拉个会议」5 字是任务，「现在的模型是什么」7 字是提问——长度与关键词都不可分。
LLM 输入必须带**前后各 3 条消息作上下文**（短指令离开上下文不可解）。

旁证增强（不作硬判据）：关联同期 OpenClaw `task_runs` 中该群会话产生的 run，写入 metadata 供事后核对。

### 判据 3 — 重发去重（本次实勘新增）
实测同一任务因秋米无响应被重发 3 次（「整理商品表格」06:30/06:52/06:54；「mcp+cli 联动」04:05/04:08/05:59）。
同一发送人 30 分钟窗口内语义等价消息合并为一行，全部 message_id 记入 metadata。

## 5. 执行回执（主理人拍板：用机器回复当凭据）

交办后 30 分钟内同群 `sender_type==='app'` 有消息 → `completed`；否则 → `blocked`，标注「群内交办未见响应」。

> **铁律：任何行都不得入 `queued`。** `tasks` 中 `status='queued' AND claimed_by IS NULL` 会被 Brain tick 每 2 分钟捡走真去执行——那等于让 Brain 去"执行"群里的客户对话。此条写成负向测试断言。

## 6. 入账

走账房 `createRoutedTask`（禁直接 INSERT INTO tasks，有 task-creation-inventory 守卫）：

```
source: 'inbox'                      // 枚举内，与 notion-push-sync.js 同源
source_id: <飞书 message_id>          // 幂等键
title: <消息前 60 字>
description: <消息全文 + 上下文>
mutation_intent: 'none'
declared_domain: 'operations'
requested_task_type: 'workflow_run'
metadata: { feishu_message_id, feishu_message_ids[], chat_id, chat_name,
            sender_open_id, sender_name, create_time, bot_replied,
            classification, openclaw_run_ids[], ledger_only: true }
task: { status: 'completed' | 'blocked', priority: 'P2' }
```

投影：既有 `pushTasks`（`notion-push-sync.js`）自动推 Notion Tasks 库，无需新代码。
`task-creation-inventory.js` 需新增一行 `{ module: 'feishu-task-ledger.js', source: 'inbox', creates_executable_task: false, migration_status: 'routed' }`，否则 CI 守卫红。

## 7. 水位与回溯

不新建表：水位 = 已入账行中最大 `create_time`（查 `tasks.payload->>'create_time'`）。
无水位时回溯 14 天（飞书 API 可拉到的窗口）。水位只为省 API 调用；正确性由 `source_id` 幂等保证。

## 8. 凭据

Brain 容器当前**无飞书凭据**（实测 `FEISHU_APP_SECRET` 为空）；秋米凭据现明文存于 `/opt/openclaw/state/clawdbot.json`，违反「1Password 唯一源」。
本单：录入 1Password CS vault → 双写 `~/.credentials/feishu-qiumi.env` → 注入容器 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`。
模块只读 env，**不读 clawdbot.json**。缺 env 时模块跳过并 warn，不抛错阻塞 scheduler。

## 9. 模块结构（纯函数内核 + 注入 IO，照 openclaw-guards.js）

`packages/brain/src/feishu-task-ledger.js`

| 导出 | 类型 | 职责 |
|---|---|---|
| `selectCandidates(messages, groupConfig, botName)` | 纯函数 | 判据 1 |
| `dedupeResends(candidates, windowMs)` | 纯函数 | 判据 3 |
| `resolveReplyEvidence(candidate, messages, windowMs)` | 纯函数 | 回执 → completed/blocked |
| `buildTaskRequest(candidate, classification)` | 纯函数 | 组装 createRoutedTask 入参 |
| `classifyCandidates(candidates, { callLLM })` | 注入 IO | 判据 2 |
| `runFeishuTaskLedger(pool, deps)` | 编排 | scheduler 入口 |

注册：`scheduler-jobs.js` 加一行，自 gate（整点窗口 + 60 分钟去重），`timeoutMs: 120_000`。

## 10. 测试

纯函数单测覆盖判据 1/3、回执映射、入参组装（含负向：提问不入账、重发只入一行、无任何 queued）。
`classifyCandidates` 以 mock `callLLM` 测；不 mock 被改的边（`createRoutedTask` 走真 DB，用 `cecelia_scratch`）。

Final E2E（禁「测试通过」空话）见 PrepPRD 第七节，核心 8 条断言全部可验证。

## 11. 不包含
- OpenClaw `automation_run` 机器执行流水入账（另立一单，决策 2dbabb48）
- 跑场机会话回收守卫
