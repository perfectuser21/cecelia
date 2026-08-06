---
task_id: 58e146e1-ff3a-4e4d-89de-17721a0ade6b
sprint_dir: sprints/08061350-relay-58e146e1
journey_type: internal_tooling
target_environment: local_api
created_at: 2026-08-06
depends_on: WS1(#4661) WS2(#4671)
anchor: factory/f5_command_deck
decisions: efa578b8 4c595c84
---

# Sprint PRD — WS3: 成品呈报 + 裁决窄口回读

## 背景

工厂·F5「舱内拍板」步加厚。前置 WS1/WS2 已 merge，采集链 L3 真验通过。本 WS 交付两个独立能力：

1. **呈报面**：排序官归并产物（提案/晨报摘要/验收单）推送到主理人 Notion 个人 Inbox，成品行含 AI 摘要 / 建议去向 / 置信度 / 需拍板 flag
2. **裁决窄口回读**：仅三个白名单结构化字段（✅放行 / ❌不放行 / ✏️批注框）按一次性提交语义消费；消费即清 + 幂等锚点；放行 → 状态流转 + decisions 留痕；批注 → 修订任务

架构约束来源：决策 efa578b8（Notion=展示层，状态机只在 Brain）+ 决策 4c595c84（结构化裁决字段一次性提交窄口，散文/双向同步全禁）。

目标库：主理人已授权 Zenithjoy-July 空间（bot cc20260728），凭据 `NOTION_INBOX_TOKEN` / `NOTION_INBOX_DB_ID`（1Password CS）。

## 范围

- 复用管线：`notion-capture-ingest.js`（采集）+ `notion-push-sync.js`（推送）+ `capture-inbox.js`（写库）
- 新建/扩展：`notion-inbox-push.js`（成品推送函数）+ `notion-verdict-ingest.js`（裁决窄口消费）
- 调度注册：`scheduler-jobs.js` 新增两个 job handler
- 不涉及：UI 层、ZenithJoy 数据库、Brain 状态机核心逻辑以外的表

## Invariant 约束

| # | 约束 | 验证方式 |
|---|------|---------|
| INV-1 | 字段解析失败 = 不执行任何动作（fail-closed） | 单测：mock Notion 返回非白名单字段 → DB 无写入 |
| INV-2 | 散文/自由文本状态字段永不回读 | 负向单测：rich_text / paragraph 类型字段 → 消费函数返回 `{skipped:true}` |
| INV-3 | 需拍板项（review_required=true）未点 ✅ 永不执行 | 单测：✅ 字段为空 / unchecked → 任务状态不变 |
| INV-4 | 幂等锚点：同一页面 / 同一 notion_page_id 只消费一次（消费即清） | 单测：重复调用 → second call returns `{skipped:true,reason:'already_consumed'}` |
| INV-5 | 呈报推送成功 → Brain 任务在 ≤5 分钟内流转 + decision 记录存在 | 集成测试：mock push → 5min scheduler 后查 tasks + decisions |
| INV-6 | 凭据缺失时静默跳过，不抛异常 | 单测：unset env → handler 返回 `{skipped:true,reason:'not_configured'}` |

**Invariant 总数：6**

## 功能需求（FR）

### FR-1：成品推送（呈报面）
- 新函数 `pushProductToNotionInbox(pool, product)` 接受排序官归并产物对象
- 产物类型白名单：`proposal` / `morning_summary` / `acceptance_receipt`
- Notion 页面 properties：
  - `Title`：产物标题（≤100 字）
  - `AI摘要`（rich_text）：LLM 一句话总结（≤200 字）
  - `建议去向`（select）：`放行` / `待拍板` / `丢弃`
  - `置信度`（number，0-1）
  - `需拍板`（checkbox）：`review_required=true` 时置 true
  - `产物类型`（select）：三类白名单之一
  - `任务ID`（rich_text）：source task_id（用于回读关联）
- 幂等键：`notion:product:<task_id>:<product_type>`
- 推送成功 → 更新 Brain 任务 `notion_page_id` 字段

### FR-2：裁决窄口回读
- 新函数 `consumeVerdictFromNotion(pool, page)` 消费单个 Notion Inbox 页面
- **白名单字段**（仅这三个，其余全忽略）：
  - `放行`（checkbox）：true = 执行放行流程
  - `不放行`（checkbox）：true = 标记拒绝
  - `批注`（rich_text，≤500 字，只取存在时追加到 task description，不触发状态流转）
- 消费逻辑：
  1. 解析字段：非白名单类型 → `{skipped:true,reason:'non_whitelist'}`（INV-1, INV-2）
  2. `需拍板=true` 且 `放行=false` → `{skipped:true,reason:'awaiting_approval'}`（INV-3）
  3. 幂等检查：`consumed_at IS NOT NULL` → `{skipped:true,reason:'already_consumed'}`（INV-4）
  4. 放行：`PATCH /api/brain/tasks/{task_id}` status=`completed` + `INSERT INTO decisions`（决策4c595c84留痕）
  5. 不放行：`PATCH /api/brain/tasks/{task_id}` status=`cancelled`
  6. 批注：仅 `PATCH description` 追加，不改 status
  7. 消费后：更新 `captures.consumed_at=now()` 作为幂等锚点
- 调度：复用 `notion-capture-ingest` 采集后触发（或独立 5min scheduler job）

### FR-3：调度注册
- `scheduler-jobs.js` 新增：
  - `notion-product-push`：handler=`runNotionProductPush`，needsPool=true，描述含「F5加厚」
  - `notion-verdict-ingest`：handler=`runNotionVerdictIngest`，needsPool=true，5min 自 gate

## NFR 段

| 维度 | 要求 |
|------|------|
| 延迟 | 推送成功到 Brain 状态流转 ≤5 分钟（scheduler 间隔决定） |
| 幂等 | 相同 notion_page_id 任意次调用结果一致，无重复 decision 行 |
| 隔离 | 凭据缺失或 Notion API 500 → 静默跳过，不影响其他 scheduler job |
| 可观测 | 关键路径日志前缀 `[notion-product-push]` / `[notion-verdict-ingest]`，返回 `{pushed,skipped,errors}` |
| 安全 | 凭据只读 env var，不落日志，不提交 git |
| 测试 | 每个 INV 至少一条单测；fail-closed 负向测试必须覆盖 INV-1/2/3 |

## 累积 FR

| WS | FR 项 |
|----|-------|
| WS1 | 采集链 L3（#4661） |
| WS2 | 链路打通（#4671） |
| WS3（本次） | FR-1 成品推送、FR-2 裁决窄口、FR-3 调度注册 |
| **累积** | **+3 FR（总计与前两 WS 累加）** |

## DoD 验收断言

| # | 验收条件 | 断言命令（可执行） |
|---|---------|-----------------|
| D1 | 成品推送成功 → notion_page_id 非空 | `node -e "const {pushProductToNotionInbox}=await import('./packages/brain/src/notion-inbox-push.js');..."` （单测覆盖） |
| D2 | 推送后 ≤5min Brain 任务状态流转 + decision 记录 | 集成测试：mock scheduler tick 后查 DB |
| D3 | fail-closed：字段解析失败不写 DB | 单测 INV-1：mock 返回 rich_text 类型 → assert decisions count unchanged |
| D4 | 负向：散文字段永不回读 | 单测 INV-2：paragraph body → `{skipped:true}` |
| D5 | 负向：需拍板未点 ✅ 不执行 | 单测 INV-3：review_required=true + 放行=false → status unchanged |
| D6 | 幂等：重复调用无重复 decision | 单测 INV-4：second call → `{skipped:true,reason:'already_consumed'}` |

## 文件边界

```
packages/brain/src/
  notion-inbox-push.js       # 新建：成品推送函数（FR-1）
  notion-verdict-ingest.js   # 新建：裁决窄口消费（FR-2）
  scheduler-jobs.js          # 扩展：+2 job 注册（FR-3）
  __tests__/
    notion-inbox-push.test.js
    notion-verdict-ingest.test.js
```

不修改：`notion-push-sync.js`（已有推送逻辑保持不变）/ `notion-capture-ingest.js`（复用其 `notionRequest` 工具函数）
