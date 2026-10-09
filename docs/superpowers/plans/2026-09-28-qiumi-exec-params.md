# 秋米派活修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 秋米任务按正文【执行参数】直派 OpenClaw，写明才传模型，正文全读，中文短标题放行。

**Architecture:** 新增纯函数模块 `routing/exec-params.js` 解析参数；`qiumi-router` 在问 Jev 之前先看参数与关联列，写明执行者即直派；执行器模型可选；正文读取抽到 `lib/notion-page-content.js` 做分页+递归。

**Tech Stack:** Node.js ESM，vitest（`cd packages/brain && npx vitest run <file>`）。

## Global Constraints

- 语言：代码注释与输出中文。
- 不猜：参数解析不出就 fail，不回落到正则。
- 执行器注入面白名单（SAFE_ID / SAFE_MODEL）不放宽。
- 每个任务 commit 顺序：先 fail test，再实现。
- 版本走 `changes/` 碎片，不碰版本五件套。

---

### Task 1: 执行参数解析 `routing/exec-params.js`

**Files:** Create `packages/brain/src/routing/exec-params.js`；Test `packages/brain/src/routing/__tests__/exec-params.test.js`

**Interfaces — Produces:**
`parseExecParams(body: string, env: {modelAllowlist: string[]}) → { present: boolean, agent: string|null, model: string|null, modelRaw: string|null, timeoutSec: number|null, acceptance: string|null, device: string|null, thinking: string|null, errors: string[] }`
`MODEL_ALIASES`（导出，别名→全名）

- [ ] Step 1 写失败测试：无块→present=false 全 null；完整块取值；全角/半角冒号；缺结束标记读到空行；别名 claude/codex/terra/sol/grok；清单全名与短名精确命中；`gpt` 这类非精确词→errors 含 `unknown_model`；超时 `30分钟`→1800、`90s`→90、`45`→2700、`500分钟`→errors 含 `bad_timeout`；思考强度非白名单→errors 含 `bad_thinking`；**回归：正文仅含「调用Agent：调用抖音平台数据采集 Agent」无参数块→model=null、errors 空**。
- [ ] Step 2 `npx vitest run src/routing/__tests__/exec-params.test.js` → FAIL（模块不存在）；commit `test(brain): 执行参数解析失败测试`
- [ ] Step 3 实现（见仓库文件，要点：块识别 `/【执行参数】([\s\S]*?)(?:【执行参数结束】|\n\s*\n|$)/`；字段名去空白小写后查表 `{执行agent,agent,执行者}→agent / {模型,model}→model / {超时,timeout}→timeout / {验收}→acceptance / {设备}→device / {思考强度,thinking}→thinking`；模型先查别名，再全名，再短名，均精确）
- [ ] Step 4 PASS；commit `feat(brain): 执行参数解析 parseExecParams`

### Task 2: 删除「用 <型号>」正则

**Files:** Modify `packages/brain/src/routing/cheap-gates.js:108-113`；Test `routing/__tests__/cheap-gates.test.js:133-165`

- [ ] Step 1 把原「用 <型号>」describe 替换为回归：`用 grok-4.7 跑` 与 `调用Agent：调用抖音平台数据采集 Agent` 都 → `hardModel=null` 且 matchedBy 不含 `text:model`。跑 → FAIL；commit
- [ ] Step 2 删除 MODEL_RE 循环（`hardModel` 字段保留恒 null）；跑 PASS；commit

### Task 3: 路由直派 + 模型不强传

**Files:** Modify `packages/brain/src/routing/qiumi-router.js`（routeQiumiTask 入口与 agent 分支）；Test `routing/__tests__/qiumi-router.test.js`

**Interfaces — Consumes:** `parseExecParams`（Task 1）

- [ ] Step 1 失败测试：
  - 参数块写 `执行Agent：media`（media 在 registry.agents）→ outcome=agent、department=media、`qiumi_route.source='explicit'`、**fetchFn 未被调用**
  - 关联列命中非部门 agent `小白` → 直派 department=小白，不调 Jev
  - 参数块 agent 不在池 → fail reason=`exec_agent_unknown`
  - 参数块模型无法识别 → fail reason=`exec_params_invalid`
  - 未写模型（直派与 Jev 两条路）→ payloadPatch.model=null
  - 写 `模型：sol` → payloadPatch.model=`openai/gpt-6-sol`
  - 写 `超时：20分钟 / 思考强度：high / 验收：xx / 设备：小龙虾` → payload timeout_sec=1200、thinking=high、acceptance、device_hint.requested=小龙虾
  - 删除原 564 行起「用 <型号>」describe
  跑 → FAIL；commit
- [ ] Step 2 实现：入口先 `parseExecParams(task.payload?.qiumi_source?.body ?? '', env)`；errors 非空→fail；设备委派分支之后、问 Jev 之前：`explicitAgent = params.agent ?? cheap.department ?? cheap.agentRef`，有则校验（params 来源须 ∈ registry.agents 名或 env.departments）后组 agent 决策（engine='explicit'，kind='agent'）；Jev 分支 `model = params.model ?? null`；公共 payloadPatch 加 `timeout_sec / thinking / acceptance`，device_hint 加 `requested`。跑 PASS；commit

### Task 4: 执行器模型可选 + 超时/思考强度

**Files:** Modify `packages/brain/src/openclaw-agent-executor.js`（buildRemoteCommand / triggerOpenclawAgent）；Test `__tests__/openclaw-agent-executor.test.js`

- [ ] Step 1 失败测试：`model:null` → 命令不含 `--model`；`timeoutSec:1200` → `--timeout 1200`；`thinking:'high'` → `--thinking high`；`thinking:'x;rm'` → 抛 invalid；triggerOpenclawAgent 在 payload 无 model 时不再返回 `missing run_id/model/department`。跑 FAIL；commit
- [ ] Step 2 实现：model 为空跳过校验与参数；THINKING 白名单 `off|minimal|low|medium|high|xhigh|adaptive|max`；timeoutSec 取整且 60–10800 之外回落 1800；trigger 传 `payload.timeout_sec / payload.thinking`；必填只剩 run_id 与 department。跑 PASS；commit

### Task 5: 正文全读 `lib/notion-page-content.js`

**Files:** Create `packages/brain/src/lib/notion-page-content.js`；Modify `notion-push-sync.js:414-443`（改为 import 并导出同名函数）；Test `__tests__/notion-page-content.test.js`

**Interfaces — Produces:** `readPageContent(pageId, { request, maxChars = 20000, maxDepth = 3 }) → Promise<string>`；`notion-push-sync.fetchNotionPageContent(token, pageId)` 签名不变。

- [ ] Step 1 失败测试（request 为注入的假函数）：分页两页都读到；`has_children` 的 toggle 下钻；table→table_row 单元格 ` | ` 连接；超 maxChars 截断且带标注；第二页请求失败时返回第一页内容；深度超 3 不再下钻。跑 FAIL；commit
- [ ] Step 2 实现并让 notion-push-sync 复用；既有 `fetchNotionPageContent` 测试中「8000 截断」断言改为 20000。跑两文件 PASS；commit

### Task 6: 秋米任务中文短标题放行

**Files:** Modify `packages/brain/src/pre-flight-check.js:39-45`；Test `__tests__/pre-flight-check.test.js`

- [ ] Step 1 失败测试：qiumi_task「抖音养号」通过标题检查、「号」被拒；dev 任务 4 字仍拒。跑 FAIL；commit
- [ ] Step 2 实现 `const minTitle = task.task_type === 'qiumi_task' ? 2 : 5`，文案带出下限。跑 PASS；commit

### Task 7: 版本碎片 + 全量相关测试

- [ ] 按 `changes/` 现有碎片格式新增一条；`npx vitest run src/routing src/__tests__/openclaw-agent-executor.test.js src/__tests__/notion-push-sync.test.js src/__tests__/notion-page-content.test.js src/__tests__/pre-flight-check.test.js src/__tests__/dispatcher-qiumi-routing.test.js` 全绿；commit
