---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 实现规格：strategic-decisions 非法 category 返回 400

## 现状（代码证据）

- `packages/brain/src/routes/strategic-decisions.js:73-104` POST 不校验 category，直接写库；数据库 CHECK `decisions_category_chk` 拦下后进 catch，`res.status(500).json({ error: err.message })` 把约束原文透给调用方。
- 允许取值唯一来源是 `packages/brain/migrations/384_decisions_nfr_category.sql:15-29`：`architecture, bug-fix, decision, deployment, feature, governance, infra, invariant, judgment, nfr, small-change, technical, testing`（另允许 NULL）。
- 路由的缺省值 `category || 'general'`（第 95 行）里的 `general` **不在**上面的允许列表，所以生产上不带 category 的请求现在同样是 500。I-2 说的“按现有默认值写入返回 201”在现状下做不到；本规格把缺省值改成允许列表里的 `decision`（语义最接近“通用决策”），这是让 I-2 成立的最小改动。
- 同表另有两条 CHECK：`packages/brain/migrations/193_knowledge_doc_author.sql:9-12` `made_by IN ('user','cecelia','system')`、`priority IN ('P0','P1','P2','P3')`。真实调用方 `packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75` 发 `made_by:'ai'`，现状同样被库拒（500），判定点一直写不进去。
- Dashboard `apps/api/features/knowledge/pages/DecisionRegistry.tsx:68` 表单默认 `category:'general'`，:110 占位提示 `technical、product、strategy`（后两者非法），:74-81 不判 `res.ok` 就关弹窗——写失败对用户静默。

### S-1
对应：I-1、I-2、I-3

新增枚举常量模块，作为 category 允许值在 JS 侧的唯一一份（INV-76cb816c）：

- 新文件 `packages/brain/src/decision-categories.js`，导出：
  - `DECISION_CATEGORIES`：冻结数组，与 migration 384 的 13 个值逐字一致、同序。
  - `DEFAULT_DECISION_CATEGORY = 'decision'`。
  - `isValidDecisionCategory(v)`：`typeof v === 'string' && DECISION_CATEGORIES.includes(v)`（大小写敏感，不 trim）。
  - `DECISION_MADE_BY = ['user','cecelia','system']`、`DECISION_PRIORITIES = ['P0','P1','P2','P3']`：冻结数组，与 migration 193 逐字一致。
- 不新增 migration、不改数据库约束。

验证：
- `node -e "import('./packages/brain/src/decision-categories.js').then(m=>{if(m.DECISION_CATEGORIES.length!==13||m.DEFAULT_DECISION_CATEGORY!=='decision'||!m.DECISION_CATEGORIES.includes(m.DEFAULT_DECISION_CATEGORY))process.exit(1)})"` 退出码 0。
- S-3 的漂移守卫测试断言该数组与 migration 384 SQL 里解析出的列表集合相等。

### S-2
对应：I-1、I-2、I-3

改 `packages/brain/src/routes/strategic-decisions.js` 的 POST：

1. 从 `../decision-categories.js` import 上述常量与函数，删除文件内的 `'general'` 字面量。
2. 在 topic/decision 必填校验、status 校验之后、写库之前加 category 校验：
   - `category` 为 `undefined` / `null` / `''` → 视为缺省，写入 `DEFAULT_DECISION_CATEGORY`（I-2）。
   - 其余情况 `!isValidDecisionCategory(category)` → `400`，响应体：
     `{ success: false, error: 'category 非法，合法值：architecture|bug-fix|...|testing', allowed_categories: [...DECISION_CATEGORIES] }`（I-1）。
   - 合法值原样写入（I-3）。
   - `made_by`、`priority` 同理（缺省仍为路由现有默认 `user` / `P2`）：传了但不在 `DECISION_MADE_BY` / `DECISION_PRIORITIES` 里 → `400`，`{ success:false, error:'made_by 非法，合法值：user|cecelia|system', allowed_made_by:[...] }`（priority 对应 `allowed_priorities`）。
3. catch 分支兜底不再透出数据库原文：
   - `err.code === '23514'`（check_violation）→ `400`，`{ success:false, error:'字段 <字段名> 取值不符合约束' }`；字段名由 `err.constraint` 查固定映射（`decisions_category_chk`→category、`decisions_made_by_check`→made_by、`decisions_priority_check`→priority，查不到写 `未知`），响应不带 `err.message` / 约束名。
   - 其它异常 → `500`，`{ success:false, error:'创建决策失败' }`；原文只进 `console.error` 服务端日志。
4. GET、PUT 行为不改（GET `?category=` 过滤沿用现有 SQL）。

失败语义：
- 400 = 调用方输入错，改 category 为 `allowed_categories` 中任一值即可重试；同样输入重试仍 400，不会写库。
- 500 = 服务端/数据库故障，可原样重试；响应体不含 SQL/约束原文。

输入对抗面：
- 大小写变体 `Decision`、带空格 `' decision'` → 400（不做归一化，避免与 DB 约束语义分叉）。
- 非字符串（数字 `1`、数组 `["decision"]`、对象）→ 400。
- 超长字符串（如 10KB）→ 400，不进数据库（先于 varchar(50) 截断报错）。
- 重复提交同一合法请求 → 各自 201、各生成一条记录（与现状一致，本次不加去重）。
- 并发：校验是纯内存判断，无共享状态，无竞态。

真实调用方 shape（QA 按此发）：
- coding workflow 判定点写库：`packages/brain/scripts/coding-workflow/activities/spec-review.mjs:70-77`，`POST <brain>/api/brain/strategic-decisions`，header `content-type: application/json`，body `{ category:'judgment', topic, decision, reason, made_by:'system', author:'coding-workflow', source_ref }`（`made_by` 由 S-4 从 `ai` 改为 `system`），无鉴权头；回读 `GET ?category=judgment&limit=1000`。
- 跨包集成测试：`packages/quality/tests/api/cross-package-integration.test.ts:175-185`，body 带 `category:'test'`（不在允许列表，改动后会从 500 变 400），见 S-4。
- Dashboard 决策登记台：`apps/api/features/knowledge/pages/DecisionRegistry.tsx:71-82`，body `{ topic, decision, reason, category }`，见 S-4。

验证：
- `cd packages/brain && npx vitest run src/routes/strategic-decisions.test.js src/routes/__tests__/strategic-decisions-category.test.js` 全绿。
- `grep -n "'general'" packages/brain/src/routes/strategic-decisions.js` 无输出。
- `grep -n "err.message" packages/brain/src/routes/strategic-decisions.js` 中 POST 段只出现在 `console.error` 里，不出现在 `res.json` 里。

### S-3
对应：I-1、I-2、I-3

回归测试（bug 修复规则：先写失败测试，永久留在 CI）：

- 新文件 `packages/brain/src/routes/__tests__/strategic-decisions-category.test.js`（vitest + supertest，mock `../../db.js`，风格同 `strategic-decisions-source-ref.test.js`）：
  1. `category:'workflow_bogus'` → status 400，`body.allowed_categories` 等于 `DECISION_CATEGORIES`，`body.error` 含 `decision`，`JSON.stringify(body)` 不含 `decisions_category_chk`、`violates`、`relation`；且 `pool.query` 未被调用。
  2. 大小写变体 `'Decision'`、数字 `1`、数组 `['decision']`、长度 10000 的字符串 → 均 400 且未写库。
  3. 不带 category、`category:null`、`category:''` → 201，`pool.query` 第二个参数的 `[0]` 为 `'decision'`。
  4. `category:'judgment'` → 201，写库参数 `[0]` 为 `'judgment'`。
  5. mock `pool.query` 抛 `{ code:'23514', constraint:'decisions_category_chk', message:'new row for relation "decisions" violates check constraint "decisions_category_chk"' }` → 400，`error` 含 `category`，响应体不含该原文；抛普通 `Error('boom SQL')` → 500，响应体不含 `boom SQL`。
  6. 漂移守卫：读 `packages/brain/migrations/384_decisions_nfr_category.sql`，正则取出 `category IN (...)` 中的引号值，集合等于 `DECISION_CATEGORIES`；读 `193_knowledge_doc_author.sql`，decisions 段的 `made_by IN (...)`、`priority IN (...)` 分别等于 `DECISION_MADE_BY`、`DECISION_PRIORITIES`。
  7. `made_by:'ai'` → 400，`body.allowed_made_by` 等于 `DECISION_MADE_BY`；`priority:'P9'` → 400，带 `allowed_priorities`；均未写库。`made_by:'system'` → 201。
- 先在未改路由的代码上跑该文件，用例 1/3/5/7 必须红；改完后全绿。

验证：`cd packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-category.test.js` 退出码 0。

### S-4
对应：I-1、I-2、I-3

修正受影响的现存调用方：

- `packages/quality/tests/api/cross-package-integration.test.ts:179` `category: 'test'` → `category: 'testing'`（`test` 不在允许列表；改动前该用例对有约束的库本就 500，改动后会 400，必须对齐）。
- `packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75` `made_by: 'ai'` → `made_by: 'system'`（migration 193 只允许 user/cecelia/system，`ai` 必被拒）；`scripts/coding-workflow/__tests__/spec-review.test.mjs:230` 的 `objectContaining` 加 `made_by: 'system'` 锁住。
- `apps/api/features/knowledge/pages/DecisionRegistry.tsx`：表单默认 `category` 改为 `''`（走服务端缺省 `decision`）；占位文案改为 `留空即 decision`，去掉 product/strategy；`submit` 检查 `res.ok`，非 2xx 时读响应 `error` 显示在弹窗内、不调 `onCreated/onClose`，`saving` 复位。不在前端抄写允许列表（合法值由服务端 `error` 文本给出，INV-76cb816c）。
- 全仓搜索其它向 `/api/brain/strategic-decisions` 写入非法 category/made_by/priority 的调用：`grep -rn "strategic-decisions" packages apps scripts --include=*.js --include=*.mjs --include=*.ts --include=*.tsx --include=*.sh`，逐个核对 body 字面量；`packages/workflows/skills/harness-contract-reviewer/SKILL.md:459` 同样核对，不合法的一并改为合法值。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs` 全绿。
- 上述 grep 结果中所有字面量 category/made_by/priority 都在允许列表内（在 PR 描述里列出核对清单）。
- Q-5、Q-8 通过。

### S-5
对应：I-1、I-2、I-3

Brain 门禁：

- `node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 均退出码 0。
- 不改 DEFINITION.md 中的事实项（本次不涉及 PORT/tick/whitelist/schema 版本）。

## QA 场景

### Q-1
对应: I-1
前提: 预览环境 Brain 已起，数据库已跑完全部 migration（含 384）。
操作: `curl -s -w '\n%{http_code}' -X POST <预览环境>/api/brain/strategic-decisions -H 'content-type: application/json' -d '{"category":"workflow_bogus","topic":"QA-cat-bogus-<随机串>","decision":"非法类别探针"}'`
期望: HTTP 400；响应 JSON `success=false`，`allowed_categories` 是包含 `decision`、`judgment`、`testing` 在内的 13 个值的数组，`error` 文本列出合法值；响应全文不含 `decisions_category_chk`、`violates`、`relation`、`check constraint`。随后 `GET <预览环境>/api/brain/strategic-decisions?limit=200` 里不存在该 topic（没写进库）。

### Q-2
对应: I-1
前提: 同 Q-1。
操作: 依次 POST 以下 body（topic 各自带随机串）：`{"category":"Decision",...}`、`{"category":1,...}`、`{"category":["decision"],...}`、category 为 10000 个 `a` 的字符串。
期望: 四次都返回 HTTP 400，响应体都带 `allowed_categories`，都不含数据库约束名或 SQL 原文；GET 列表里查不到这四个 topic。

### Q-3
对应: I-2
前提: 同 Q-1。
操作: `curl -s -w '\n%{http_code}' -X POST <预览环境>/api/brain/strategic-decisions -H 'content-type: application/json' -d '{"topic":"QA-cat-default-<随机串>","decision":"不带类别"}'`；再用 `"category":""` 和 `"category":null` 各发一次（topic 不同）。
期望: 三次均 HTTP 201，`data.category` 为 `decision`，`data.id` 非空；`GET <预览环境>/api/brain/strategic-decisions?category=decision&limit=200` 的 `data` 中能找到这三个 topic。

### Q-4
对应: I-3
前提: 同 Q-1。
操作: POST `{"category":"decision","topic":"QA-cat-valid-<随机串>","decision":"合法类别"}`；再 GET `<预览环境>/api/brain/strategic-decisions?category=decision&limit=200`。
期望: POST 返回 201 且 `data.category=decision`；GET 返回 200，`data` 中有且仅有一条该 topic，`category` 为 `decision`、`status` 为 `active`。

### Q-5
对应: I-3
前提: 同 Q-1。
操作: 按 coding workflow 修正后的真实调用 shape（spec-review.mjs:70-77，S-4）发：POST body `{"category":"judgment","topic":"判定点[qa000000#1]: QA-<随机串>","decision":"所选方法: x｜候选: y","reason":"依据: z","made_by":"system","author":"coding-workflow","source_ref":"coding-workflow:qa"}`；再 GET `?category=judgment&limit=1000`。
期望: POST 201；GET 返回中能按该 topic 找到记录，`made_by=system`、`author=coding-workflow`。

### Q-7
对应: I-1
前提: 同 Q-1。
操作: POST `{"category":"judgment","topic":"QA-madeby-<随机串>","decision":"旧 shape 探针","made_by":"ai"}`；再 POST `{"topic":"QA-prio-<随机串>","decision":"优先级探针","priority":"P9"}`。
期望: 两次均 HTTP 400；前者响应带 `allowed_made_by`（`user`、`cecelia`、`system`），后者带 `allowed_priorities`（`P0`–`P3`）；响应全文不含 `check constraint`、`violates`；GET 列表查不到这两个 topic。

### Q-8
对应: I-1、I-2
前提: Cecelia Dashboard 本机 `mac_web`（localhost:5174）已连预览环境 Brain。
操作: 打开「决策登记台」→ 点“记录决策” → 填主题 `QA-ui-default-<随机串>`、决策内容，分类留空 → 点“记录”；再开一次，主题 `QA-ui-bad-<随机串>`，分类填 `product` → 点“记录”。
期望: 第一次弹窗关闭，列表出现该主题且分类为 `decision`；第二次弹窗不关，弹窗内可见错误文字，其中列出 `decision`、`judgment` 等合法值，列表中不出现该主题。截图留证。

### Q-6
对应: I-1、I-3
前提: 同 Q-1。
操作: 同一个合法 body（`category":"decision"`，固定 topic `QA-cat-dup-<随机串>`）连发两次；同一个非法 body（`category":"workflow_bogus"`）连发两次。
期望: 合法请求两次都是 201，GET 能查到两条同 topic 记录（与现状一致，不去重）；非法请求两次都是 400，内容一致，均未写库。

## 铁律对照

- INV-909ce765：不适用：本改动只改 strategic-decisions 路由与测试，不碰 Deploy Preview Environment 的部署链；若 PR 上该非 required check 失败，按此铁律确认是既有故障后单独立案，不在本 PR 追修。
- INV-76cb816c：S-1、S-3 覆盖（category/made_by/priority 允许值只在 `decision-categories.js` 一份，路由 import 使用，并用漂移测试锁死与 migration 384/193 一致；Dashboard 不抄副本，靠服务端 error 给出合法值）。
- INV-ae4b4428：S-2、Q-1 覆盖（校验是写库前的代码内联判断，不合法直接 return 400，不靠事后探针）。
- INV-564802ee：S-2、Q-1 覆盖（响应体不再回显数据库原文，内部错误信息只进服务端日志）。
- INV-e9c7752f：S-2 覆盖（校验失败分支显式 return 400，不依赖外层 try/catch 兜底）。
- INV-052e10a0：S-4 覆盖（枚举校验收紧后全仓 grep 写入方（含 *.tsx），`test`、`made_by:'ai'`、Dashboard 默认 `general` 等非法字面量逐个改正）。
- INV-c906dd6c：S-3 覆盖（验证命令在 `packages/brain` 目录下用 vitest include 范围内的路径跑，不指向 sprints/**）。
- INV-3efefc23：不适用：本次是 fix 而非新功能，且不新增 brain/src 子系统；QA 场景会由 runner 固化为 smoke，不另手写 smoke 与 allowlist。
- INV-50954d28：不适用：本次不新增端点，也不改该端点的鉴权方式（真实调用方 spec-review.mjs 无鉴权头，保持原样）；端点鉴权缺口不在本单范围。
- INV-52f1801e：不适用：不新增依赖，无需安装；若需装依赖只在仓库根跑 npm ci。
- INV-1129ee0d：不适用：不涉及权限、资金、外部发布；写入的是预览环境测试库，不碰生产数据。
- INV-96054a8b：不适用：改动只在 Brain 代码与测试，不在 us-vps 上执行任何任务；QA 走预览环境不走生产。
- INV-0dc6b84f：不适用：本规格的执行地与模型由 runner 决定，本改动不改 coding 链本身。

## 未覆盖真实链路

- 生产库：QA 只在预览环境验证，生产 Brain（us-vps）上的 400/201 行为需合并部署后由调用方（coding workflow 判定点写库）自然流量确认；QA 不碰生产。
- 跨包集成测试 `cross-package-integration.test.ts` 只在 Brain 可达时运行，CI 空环境可能跳过；S-4 的修正仅靠代码审查与预览环境 Q-4 间接覆盖。

## 判定点

无：本改动不推断任何外部真实状态，只做请求体字段的确定性校验。
