# PrepPRD：飞书群交办入账（源头打点版）

> 发起 task: `abcbc09f-d4c9-40db-a6fd-594fce901674`
> 上游要求：主理人 2026-09-16「群里给 agent 布置的任务，每天回填到 Cecelia task database / Notion」
> 前序交接单：`docs/handoffs/202609161427-openclaw-taskruns-ledger-IMPL.md`（**核心口径已被本次实勘推翻**）

## 一、实勘推翻了交接单的三个前提

| 交接单说 | 实测 |
|---|---|
| 用 Node 内置 `node:sqlite` 读 OpenClaw 库 | Brain 容器 Node v20.20.2 无该模块（22.5+ 才有） |
| `task_kind=null` = 人派的活（507 行正题） | 实为 workflow 阶段 273 + OPC 心跳 104 + 班会 cron 60 + 探活噪音 55 |
| 群里布置的任务可从 task_runs 回填 | 飞书群通道在 task_runs 只有 13 行，全是 `Background CLI command` / gateway restart，**零条可读任务** |

补充：`channel_ingress_events` 396 条飞书事件 `payload_json` 全被清成 `"null"`；`worker_transcript_commits`/`session_state_events` 无任何飞书会话。
**结论：OpenClaw sqlite 不留群消息原文，纯搬运不可行，必须走源头（飞书 API）。**

## 二、真数据源（已验证）

飞书开放平台 API，用 OpenClaw feishu main app 凭据（该 app 本就在群里）：
- `auth/v3/tenant_access_token/internal` → token ✅
- `im/v1/messages?container_id_type=chat&container_id=<chat>&start_time=<ts>` → 群消息历史 ✅（含原文/发送人/mentions/时间）

在册三群（`clawdbot.json` → channels.feishu.accounts.main）：

| chat_id | 名称 | requireMention | 14天人发 | @秋米 |
|---|---|---|---|---|
| oc_ee3fe0…26de | 悦升云端 | true | 1443 | **81** |
| oc_ef60d6…d662 | VPS 状态 | false | 17 | 2 |
| oc_e5ff09…41ae | 外部Ai体验区 | （默认） | 13 | 13 |

## 三、判据（主理人 2026-09-16 两次拍板）

**判据 1（机械）：@ 的必须是秋米，不是人。**
232 条带 @ 的消息里被 @ 对象：徐啸 101 / **秋米 81** / 于瑾 29 / 苏彦卿 23。只有 @秋米 的进入候选。
`requireMention=false` 的群（VPS 状态）则所有人发消息进候选。

**判据 2（语义）：秋米能立即回答、没调 agent 去干的，不算任务。**
- 任务 = 要求 agent 执行动作并产出结果（「帮我建三个飞书文档」「把抖音读昵称沉淀成 Skill」「整理成表格」）
- 非任务 = 索取信息（「表在哪」「现在的模型是什么」）／粘贴报错求解释／状态告知（「授权成功了」）／闲聊
实测 81 条 → 真任务约 16-18 个 / 14 天（≈1.2 个/天）。

**判定点登记**：语义分类由 LLM 判（规则做不准——「你拉个会议」5 字是任务，「现在的模型是什么」7 字是提问）。
误判后果：漏记真任务（中，主理人看不到派过的活）／错记提问（低，噪音一行）。
佐证增强：关联同期 OpenClaw `task_runs` 该群会话是否产生 run，作为「真调了 agent」的旁证。

**判据 3（去重，本次实勘新增）**：同一任务会被重发（实测「整理商品表格」发 3 次、「mcp+cli 联动」发 3 次，因秋米无响应）。
30 分钟窗口内同一发送人语义等价的消息合并为一条，metadata 记全部 message_id。

## 四、执行回执（主理人拍板：用机器回复当凭据）

交办后 30 分钟内同群秋米有回复 → `completed`；无回复 → `blocked` + 标注「群内交办未见响应」。

> ⚠️ **铁律：绝不入 `queued`**。tasks 表 queued + claimed_by IS NULL 会被 Brain tick 每 2 分钟捡走真去执行——那会让 Brain 去"执行"群里的客户对话。

## 五、入账

走正规账房 `createRoutedTask`（禁直接 INSERT INTO tasks，有 task-creation-inventory 守卫）：
- `source='inbox'`，`source_id=<飞书 message_id>`（幂等键）
- `mutation_intent='none'`、`declared_domain='operations'`、`requested_task_type='workflow_run'`
- `metadata`: chat_id / chat_name / sender_open_id / sender_name / message_ids[] / create_time / bot_replied / openclaw_run_ids[]
- 新模块需在 `task-creation-inventory.js` 登记一行，否则 CI 守卫红

投影：既有 `pushTasks`（notion-push-sync.js）自动推 Notion Tasks 库，无需额外开发。

## 六、凭据

飞书 app 凭据当前**明文躺在 `/opt/openclaw/state/clawdbot.json`**（违反「1Password 唯一源」）。
本单：录入 1Password CS vault → 双写 `~/.credentials/feishu-openclaw.env` → Brain 从 env 读，**不从 clawdbot.json 读**。

## 七、验收标准（Final E2E，禁「测试通过」空话）
- [ ] 跑一次后 `SELECT count(*) FROM tasks WHERE payload->>'feishu_message_id' IS NOT NULL` > 0
- [ ] 抽 3 条比对：title/description/发送时间与飞书 API 原文逐字一致
- [ ] 重复跑两次，计数不翻倍（幂等真生效）
- [ ] Notion Tasks 库 API 读回验证这些行存在（非「应该会推」）
- [ ] 负向断言：「表在哪」「现在的模型是什么」等提问未入账
- [ ] 负向断言：重发 3 次的「整理商品表格」只入 1 行
- [ ] 负向断言：结果集中 `status='queued'` 计数 = 0（防 tick 误执行）
- [ ] CI 全绿

## 八、不包含
- OpenClaw `automation_run` 机器执行流水入账（另立一单，决策 2dbabb48）
- 跑场机会话回收守卫（同族待办）
