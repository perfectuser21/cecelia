# Inbox 统一捕获系统设计（工程域 Vibe Coding / Insight）

- **日期**: 2026-07-19
- **状态**: 待 Alex 审阅
- **决策锚点**: decisions a823206d（A/C 退役拍板）
- **参照系**: Notion Ideas 捕获系统（作品域，保持不动）；本设计是它在工程域的镜像

---

## 1. 背景与现状诊断（生产库实锤，非猜测）

07-19 查生产库结论：

| 轨道 | 设计意图 | 真实状态 |
|---|---|---|
| A digestion | 手动记录→captures→LLM拆6类→atoms | 形同虚设：captures 全库 2 行 |
| B triage | handoff/learning/issue→atoms→四路分诊 | 唯一活着的轨道：60 atoms，32 条卡 pending_review（low_confidence/no_journey 为主） |
| C conversation-digest | 扫 .jsonl 对话→LLM提炼→落库 | 从未跑通：4 个月 58,969 条 error cursor，目标表字段错位，写入 0 行，无任何消费方 |

其他发现：
- `capture-triage.js` 四路里 **urgent 和 okr 是死胡同**——只标 confirmed，无任何下游动作（capture-triage.js:147-148, 223-224）。
- learnings 表近 30 天产出 1,347 条，进过 inbox 的历史累计仅 48 条，捕获率 ~3%。
- `memory_stream` 已有 `embedding vector(1536)` 列——**pgvector 基建已存在**，覆盖率仅 0.7%。指纹去重是"接管半拉子工程"，不是从零建。
- Cecelia 意识流（suggestions 16,852 条全 pending / desires 17,878 / cecelia_events 59万 / cortex_analyses 8,305）是**另一族问题，明确排除在本设计范围外**。

## 2. 已定决策

1. **轨道 C 退役**：删除 `conversation-digest.js` + job 注册 + `conversation_captures`/`conversation_log_cursors` 相关链路。"跨会话记忆"职能已由 Notion 会话总结 skill + Claude Code 原生 auto-memory 接管。（decisions a823206d）
2. **轨道 A 的 6 类 LLM 拆解逻辑退役**：删除 `capture-digestion.js`。**captures 表保留并升格为新主干的 L0 入口**。
3. **范围边界**：只收两类——①做完任务的系统产出（handoff/learning/issue，后续可扩 PR merge/CI 失败/部署事件）②Alex 本人的想法/洞察。Cecelia 自身意识流不进本 inbox。
4. **域分工**：Notion 管作品（内容），Brain 管 vibe coding（工程）。两套不合并；工程侧发现的内容灵感通过单向桥送 Notion Ideas。

## 3. 架构总览：Notion 形状的五条借鉴

1. **唯一入口 + 生命周期长在 capture 自己身上**（对标 Ideas 的 Status: Capture→…→Done/Dropped）
2. **派生而不搬家**：capture 原地留存，加工产物在专门表里生成新记录并回链（对标 Ideas→Content_Seed/Insights 的 relation）
3. **Dropped 是合法终态**：允许明确弃置，不产生永久积压
4. **Review Date = 账龄哨兵**：超期未达终态必告警
5. **Related 互链 = 指纹去重**：相似历史自动挂链、老问题续接计数

## 4. 数据模型（复用现有两表，改造不新建）

```
captures        L0 唯一入口 + 生命周期状态机（= 工程域 Ideas 库）
capture_atoms   原子化层：1 capture 可拆 N 原子，各自独立路由
routed_to_table/routed_to_id   派生回链（= Notion relation，血缘可追溯）
```

### captures 表扩展字段

| 字段 | 说明 |
|---|---|
| `nature` | 出身已知来源在进箱时直接写（learning/issue/handoff）；自由输入留空待定性 |
| `repo` / `lane` | 信封元数据，进箱时尽量补齐 |
| `ref_task_id` / `ref_journey_id` / `ref_pr_url` | 关联引用 |
| `dedupe_key` | 幂等锚，同一事件重复推送只进一条 |
| status 扩展 | `captured → clarified → done / dropped`（替换现有 inbox/processing/done/archived 语义） |

### capture_atoms 表扩展字段

| 字段 | 说明 |
|---|---|
| `nature` | idea / desire / dev_task / research / decision / reference / content_idea |
| `repo` / `lane` / `cross_flag` | ③定位产出 |
| `fingerprint` / `similar_ids` / `recurrence_count` | 指纹查重产出："第 N 次出现" |
| `research_notes` | GitHub 调研摘要（可选步骤产出） |
| `retry_count` | llm_failed 自动重试计数 |
| status 扩展 | `pending → enriched → routed / dropped / parked` |

## 5. 主链路：5 步 + 2 旁路

```
①进箱 → ②定性+拆原子 → ③定位 → ④路由 → ⑤落地派生
captures:  captured ──→ clarified ─────────────→ done/dropped
atoms:               pending ──→ enriched ──→ routed/dropped/parked
旁路⑥ 人工复核（parked 专用，前端交互）    旁路⑦ 账龄哨兵 + 重试
```

### ① 进箱（写入即返回，零判断）
- **实现**：统一端点 `POST /api/brain/captures`；改造 `capture-inbox.js`（pushCaptureAtom → pushCapture，直写 atoms 的旁路封死）
- **调用方**：harness 产出 handoff/learning/issue 的 push；Alex 对话内"记一下"；飞书 webhook；Dashboard 快捷输入框
- **信封在进箱一刻焊死**：`{content, source, nature?, repo?, lane?, ref_task_id?, ref_journey_id?, dedupe_key}`。出身已知来源必须带 nature 与 refs——治 no_journey 的根在入口，不在分诊。

### ② 定性 + 拆原子
- **实现**：新 job `capture-clarify.js`，注册 `scheduler-jobs.js`；只处理 `status='captured' AND nature IS NULL`（自由输入）；出身已知自动跳过
- **逻辑**：便宜关键词规则先判；判不了调 thalamus（便宜模型）一次调用同时定性+拆分，返回原子数组各带 nature
- **落库**：captures → clarified；生成 N 条 atom（pending）

### ③ 定位（纯查询为主，少调/不调 LLM）
- **实现**：新 job `capture-scout.js`，三个动作：
  1. **repo/lane 识别**：ref_task_id 反查 journey → 兜底关键词规则；跨 repo/lane 打 `cross_flag`
  2. **指纹查重**：pg_trgm 文本相似度扫近 90 天 atoms + issues（Postgres 内置，零新基建）；命中挂 `similar_ids` + `recurrence_count`
  3. **GitHub 调研**（可选）：仅 nature=dev_task/research 且查重未命中时，`gh search` 拉相关 issue/PR 摘要存 `research_notes`
- **落库**：atom → enriched，背景信息全写在 atom 身上

### ④ 路由（带背景做决定）
- **实现**：升级现有 `capture-triage.js`——cheap-rule + LLM + 事务写入骨架保留；prompt 注入③的背景（repo/lane/相似历史/调研摘要）
- **三种出口**：能定 → routed；LLM 低置信 → **parked**（进人工队列，不再是永久黑洞）；确认无价值 → dropped

### ⑤ 落地派生（每条路必须有真实消费者——死规矩）

| nature / 路由 | 真实下游 |
|---|---|
| dev_task | `tasks` 表 → /dev 管道（已有） |
| research | research 类 task（已有 research skill） |
| decision | `decisions` 表（已有） |
| reference / insight | `knowledge` 表（已有） |
| content_idea | **单向桥写 Notion Ideas（status=Capture）** |
| 老问题复现（recurrence_count>1） | 续接已有 issue，计数+1，**不新开** |
| urgent | 建真实 task + Bark 告警（封死现有死胡同） |
| okr | 写 `notes` 表（type=strategic_input），下次 strategy_session 任务的上下文自动注入（封死现有死胡同） |
| dropped | 合法终态，留痕 |

- 全部沿用 triage 里 invariant 路的事务模式（BEGIN/COMMIT + reason 内嵌 atom:id 幂等锚），`routed_to_table/routed_to_id` 回链。

### ⑥ 旁路：人工复核（parked 专用）
- Dashboard 收件箱页（见 §6）列出 parked 条目 + 卡住原因；Alex 一键改判 nature / 手动指定路由 / drop
- 现有 `routes/capture-atoms.js` confirm 接口扩展；新增 `capture_corrections` 记录表——**每次人工纠正留档，攒够沉淀成②④的新 cheap rule（学习环）**

### ⑦ 旁路：账龄哨兵 + 重试
- 新 job `capture-aging.js`：任何非终态条目超 N 天（默认 7）→ 飞书/Bark 告警 + Dashboard 标红
- llm_failed 自动重试 ≤3 次（retry_count），超限转 parked

## 6. 前端（一等公民，Alex 硬性要求：可见 + 可控 + 可交互）

位置：`apps/dashboard`（Cecelia Dashboard，本机 5211 / HK 生产双实例，走 Brain webhook 部署）。E2E 按死规则走 `mac_web`。

### 6.1 收件箱页（新路由 /inbox）
- **管道视图**：五步漏斗计数条（captured/clarified/enriched/routed/parked/dropped 各多少），点击任一段下钻列表
- **列表视图**：筛选（阶段/nature/来源/repo/lane/账龄），账龄超期标红
- **详情抽屉**：信封元数据、拆出的原子、定位背景（相似历史链、recurrence 计数、调研摘要）、路由结果 + 回链跳转（点击直达派生出的 task/decision/knowledge/issue）

### 6.2 交互能力（不止是看）
- **快捷捕获输入框**：页面顶部一个框，敲一句话回车即进箱（①的 Dashboard 入口）
- **改判**：parked 条目上直接改 nature / 从下拉选路由目的地 / drop，一键执行（走 confirm 接口，写 corrections）
- **重试**：llm_failed 条目手动触发重跑
- **续接确认**：查重命中"疑似老问题"时，前端展示相似候选，Alex 可确认续接或判定为新问题

### 6.3 支撑 API（Brain 侧新增/扩展）
- `GET /api/brain/captures?stage=&nature=&lane=&aging=` 列表+计数
- `GET /api/brain/captures/:id` 详情（含 atoms + 背景 + 回链）
- `POST /api/brain/captures` 进箱（①）
- `PATCH /api/brain/capture-atoms/:id/confirm` 改判/手动路由/drop（扩展现有）
- `POST /api/brain/capture-atoms/:id/retry` 重试

## 7. 分期计划（每期独立可交付，含验收标准）

| 期 | 内容 | 验收标准 |
|---|---|---|
| **P0 清场** | 删 `conversation-digest.js`、`capture-digestion.js` + job 注册；migration DROP `conversation_captures`/`conversation_log_cursors`（数据无留存价值：前者 0 行，后者全是过期文件路径指针）；记 Notion Issue 归档 C 的 4 个月静默失败 | tick 日志不再出现两 job；两表已 DROP |
| **P1 主干+可见** | 信封字段 migration；统一进箱端点；harness push 改道走 captures；状态机；封 urgent/okr 死胡同；账龄哨兵；Dashboard 收件箱页 v1（漏斗+列表+详情+改判）；消化 32 条积压 | 新 learning 产出后 5 分钟内在 /inbox 页可见全链路状态；32 条积压清零（路由或 drop）；urgent 路由产生真实 task+Bark |
| **P2 Alex 入口** | 对话"记一下"→进箱挂接；飞书 webhook 入口；快捷捕获框；②定性 job；Notion Ideas 单向桥 | Alex 从任一入口丢一句话，2 分钟内完成定性并出现在漏斗中；content_idea 类在 Notion Ideas 出现且 status=Capture |
| **P3 指纹** | pg_trgm 查重；repo/lane 定位；续接已有 issue；前端相似候选交互 | 人为重复推送同一问题 3 次 → 只有 1 条 issue，recurrence_count=3 |
| **P4 升级** | embedding 语义查重（复用 pgvector）；GitHub 调研步骤 | 文字不同但语义相同的两条输入被判为相似；dev_task 类 atom 带 research_notes |
| **P5 飞轮闭环** | corrections 沉淀 cheap rule；已解决任务的方案回写指纹库 | 同类问题再现时，详情页展示"上次的解决方案"链接 |

## 8. 非目标（明确不做）

- 不处理 Cecelia 意识流（suggestions/desires/cecelia_events/cortex_analyses/memory_stream）——另立项目
- 不重建轨道 C 的对话扫描——已被 memory 系统取代
- 不动 Notion 作品域捕获系统——只建单向桥
- 不在 P1-P3 引入新基建（embedding 复用已有 pgvector，查重首版用 pg_trgm）
