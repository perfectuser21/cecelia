---
task_id: 58e146e1-ff3a-4e4d-89de-17721a0ade6b
sprint_dir: sprints/08061350-relay-58e146e1
journey_type: internal_tooling
target_environment: local_api
round: 1
---

# Sprint Contract Draft — WS3: 成品呈报 + 裁决窄口回读

## Response Schema（推导来源: PRD FR-1/FR-2 输出合约）

### pushProductToNotionInbox 返回
```json
{
  "pushed": 1,
  "skipped": 0,
  "notion_page_id": "string | null",
  "errors": 0
}
```

### consumeVerdictFromNotion 返回
```json
{
  "skipped": false,
  "reason": "string | null",
  "action": "approved | rejected | annotated | null",
  "task_id": "uuid | null"
}
```

### scheduler-jobs.js runSchedulerJobsOnce 新增 job 表项
- `notion-product-push`：`{ name, needsPool:true, handler, description }`
- `notion-verdict-ingest`：`{ name, needsPool:true, handler, description }`

---

## 接缝清单（写断言前必答：这功能在哪几个点碰真实世界？）

| # | 接缝点 | 类型 | 真目标验证方式 |
|---|---|---|---|
| 1 | 成品推送调用 Notion API（POST /pages） | 外部接缝 | mock notionRequest → 断言调用参数含所有白名单属性 |
| 2 | 推送后回写 Brain tasks.notion_page_id | DB 写入接缝 | mock pool.query → 断言 UPDATE tasks SET notion_page_id |
| 3 | 裁决消费调用 Brain PATCH /api/brain/tasks/{id} | HTTP 接缝 | mock fetch → 断言 PUT body 含 status=completed/cancelled |
| 4 | 裁决消费后写 decisions 表 | DB 写入接缝 | mock pool.query → 断言 INSERT INTO decisions |
| 5 | 幂等锚点：消费后更新 captures.consumed_at | DB 写入接缝 | mock pool.query → 断言 UPDATE captures SET consumed_at |
| 6 | 凭据缺失静默跳过 | 配置接缝 | unset NOTION_INBOX_TOKEN → 断言返回 `{skipped:true,reason:'not_configured'}` |
| 7 | scheduler-jobs.js JOBS 数组注册两个新 job | 代码结构接缝 | 读 scheduler-jobs.js → 断言 notion-product-push / notion-verdict-ingest 存在 |

逻辑断言（单测 mock 层）：vitest 覆盖 INV-1 至 INV-6，CI 绿 = 逻辑 done
接缝断言（manual:bash）：读文件 / 执行可执行命令，script exit 0 = 接缝 done

---

## 已知约束（来自回归测试与前序 WS）

- `notion-capture-ingest.js` 已有 `notionRequest` 工具函数，WS3 复用，不重写
- `notion-push-sync.js` 现有推送逻辑不修改（PRD 明确）
- scheduler-jobs.js 现有 JOBS 尾端追加，不调整已有 job 顺序
- `captures.consumed_at` 字段已在 WS1/WS2 迁移中存在（依赖 #4661/#4671）

---

## Risks

| # | 风险 | 严重度 | Mitigation |
|---|---|---|---|
| 1 | Generator 实现 `consumeVerdictFromNotion` 时混入散文 rich_text 字段处理，违反 INV-2 | High | INV-2 负向单测：rich_text/paragraph 类型 → `{skipped:true}`，必须 CI 红才 done |
| 2 | 幂等检查逻辑不完整：仅检查内存状态而非 consumed_at DB 字段 | High | INV-4 单测：第二次调用前 mock pool.query 返回 consumed_at NOT NULL → 断言 `{skipped:true,reason:'already_consumed'}` |
| 3 | scheduler-jobs.js 注册后没有正确传递 pool，导致 needsPool:true 但 handler 未收到 | Medium | BEHAVIOR:调度注册测试 + scheduler-jobs.test.js mock 覆盖 |
| 4 | 成品推送属性类型发错（Notion 400 bad_request）| Medium | 合同测试断言属性结构完整（title/rich_text/select/checkbox/number 各类型正确） |

---

## Golden Path

```
[排序官归并产物（proposal/morning_summary/acceptance_receipt）]
  → [pushProductToNotionInbox 构造属性 + 调用 Notion API POST /pages]
  → [Notion Inbox 新页面创建，含 AI摘要/建议去向/置信度/需拍板/产物类型/任务ID]
  → [回写 Brain tasks.notion_page_id]

[主理人在 Notion 页面填写裁决字段（✅放行 或 ❌不放行 或 批注）]
  → [notion-verdict-ingest scheduler job 5min 轮询]
  → [consumeVerdictFromNotion 解析三字段白名单]
  → [放行 → PATCH tasks status=completed + INSERT decisions]
  → [captures.consumed_at=now() 幂等锚]
```

---

### Step 1: 成品推送函数 pushProductToNotionInbox 调用 Notion API

**来源**: `[FROM_PRD]` — FR-1：新函数接受排序官归并产物对象，产物类型白名单 proposal/morning_summary/acceptance_receipt

**可观测行为**: 构造 Notion pages 属性（Title/AI摘要/建议去向/置信度/需拍板/产物类型/任务ID），调用 notionRequest POST /pages，返回 `{pushed:1, notion_page_id:"..."}`

**验证命令**:
```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('/workspace/packages/brain/src/notion-inbox-push.js', 'utf8');
if (!c.includes('pushProductToNotionInbox')) { console.error('FAIL: 函数不存在'); process.exit(1); }
if (!c.includes('notion:product:')) { console.error('FAIL: 幂等键前缀缺失'); process.exit(1); }
['proposal','morning_summary','acceptance_receipt'].forEach(t => {
  if (!c.includes(t)) { console.error('FAIL: 白名单类型缺失: '+t); process.exit(1); }
});
console.log('OK');
"
```

**硬阈值**: exit 0，函数存在且含幂等键和三种产物类型

---

### Step 2: 成品推送后回写 notion_page_id 到 Brain tasks 表

**来源**: `[FROM_PRD]` — FR-1: 推送成功 → 更新 Brain 任务 notion_page_id 字段

**可观测行为**: pool.query 被调用并包含 `UPDATE tasks SET notion_page_id`

**验证命令**:
```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('/workspace/packages/brain/src/notion-inbox-push.js', 'utf8');
if (!c.includes('notion_page_id')) { console.error('FAIL: notion_page_id 回写逻辑缺失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 源码中含 notion_page_id 回写

---

### Step 3: 裁决窄口消费函数 consumeVerdictFromNotion 解析白名单字段

**来源**: `[FROM_PRD]` — FR-2：白名单字段仅三个（放行/不放行/批注），非白名单返回 skipped

**可观测行为**: 放行=true → PATCH tasks status=completed + INSERT decisions；不放行=true → PATCH status=cancelled；批注 → PATCH description；非白名单 → `{skipped:true}`

**验证命令**:
```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('/workspace/packages/brain/src/notion-verdict-ingest.js', 'utf8');
if (!c.includes('consumeVerdictFromNotion')) { console.error('FAIL: 函数不存在'); process.exit(1); }
if (!c.includes('already_consumed')) { console.error('FAIL: 幂等锚点处理缺失'); process.exit(1); }
if (!c.includes('not_configured')) { console.error('FAIL: 凭据缺失处理缺失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，函数存在且含幂等+凭据处理

---

### Step 4: scheduler-jobs.js 注册两个新 job

**来源**: `[FROM_PRD]` — FR-3：scheduler-jobs.js 新增两个 job handler

**可观测行为**: JOBS 数组中存在 `notion-product-push` 和 `notion-verdict-ingest`，needsPool=true

**验证命令**:
```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('/workspace/packages/brain/src/scheduler-jobs.js', 'utf8');
if (!c.includes('notion-product-push')) { console.error('FAIL: notion-product-push job 缺失'); process.exit(1); }
if (!c.includes('notion-verdict-ingest')) { console.error('FAIL: notion-verdict-ingest job 缺失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，两个 job 均在 scheduler-jobs.js 中

---

## E2E 验收（Final E2E — target_environment: local_api）

**journey_type**: internal_tooling
**target_environment**: local_api
**执行方式**: vitest 单测 + manual:bash 命令，无 Playwright UI 验证（后端 scheduler job，无前端界面）

```bash
# E2E 验收 Step 1：文件存在性
node -e "
['notion-inbox-push.js','notion-verdict-ingest.js'].forEach(f => {
  require('fs').accessSync('/workspace/packages/brain/src/'+f);
  console.log('OK: '+f+' 存在');
});
"

# E2E 验收 Step 2：scheduler-jobs.js 注册两个新 job
node -e "
const c = require('fs').readFileSync('/workspace/packages/brain/src/scheduler-jobs.js','utf8');
['notion-product-push','notion-verdict-ingest'].forEach(j => {
  if (!c.includes(j)) { console.error('FAIL: job 未注册: '+j); process.exit(1); }
  console.log('OK: '+j+' 已注册');
});
"

# E2E 验收 Step 3：运行合同单测，所有 INV 覆盖通过
cd /workspace && npx vitest run packages/brain/src/__tests__/notion-inbox-push.test.js packages/brain/src/__tests__/notion-verdict-ingest.test.js --reporter=verbose
```

**PASS 标准**: 所有 Step exit 0，vitest 单测全绿（≥6 条 INV 测试 pass）
**FAIL 标准**: 任意 Step exit 1 OR 单测红

---

## 未覆盖真实链路清单

| # | 未覆盖链路 | 原因 | 风险等级 |
|---|---|---|---|
| 1 | 真实 Notion API 调用（NOTION_INBOX_TOKEN 真实凭据） | 凭据不提交 git，单测全 mock | Low — INV-6 凭据缺失 fallback 已覆盖 |
| 2 | Brain DB 真实写入（tasks.notion_page_id / decisions 表） | local_api 无真实 DB 连接，pool 全 mock | Low — 逻辑由单测 mock 验证完整 |
| 3 | scheduler 真实 5min 轮询触发 | 定时器测试开销过大；JOBS 数组注册测试已间接验证 | Low — 调度框架由 scheduler-jobs.test.js 覆盖 |
| 4 | 呈报推送→5min 内 Brain 任务流转（INV-5 集成测试）| 依赖真实 scheduler tick 运行，内存状态外部不可见 | Medium — 单测 mock scheduler tick 后查 DB 断言已部分覆盖 |

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 成品推送 | `sprints/08061350-relay-58e146e1/tests/notion-inbox-push.contract.test.js` | INV-3/INV-4/INV-6/FR-1 | → 4+ failures（函数未实现时） |
| 裁决窄口消费 | `sprints/08061350-relay-58e146e1/tests/notion-verdict-ingest.contract.test.js` | INV-1/INV-2/INV-3/INV-4/INV-6 | → 5+ failures（函数未实现时） |
| 调度注册 | `sprints/08061350-relay-58e146e1/tests/scheduler-jobs-ws3.contract.test.js` | FR-3 | → 2 failures（job 未注册时） |

> 仓库运行副本：`packages/brain/src/__tests__/notion-inbox-push.test.js` / `notion-verdict-ingest.test.js` / `scheduler-jobs-ws3.test.js`（与上表 sprint 合同测试同源，由 CI brain-unit 执行）。
