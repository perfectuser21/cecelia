---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 实现规格：POST /api/brain/strategic-decisions 非法 category 返回 400

## 现状（读代码确认）

- `packages/brain/src/routes/strategic-decisions.js:73-104`：POST 不校验 category，直接 `INSERT ... [category || 'general', ...]`；数据库 CHECK 拒绝时进 catch，`res.status(500).json({ success:false, error: err.message })`，把 PG 原文（含约束名 `decisions_category_chk`）透给调用方。
- category 的唯一约束真身在数据库：`packages/brain/migrations/384_decisions_nfr_category.sql` 建的 `decisions_category_chk`，白名单 13 个值（architecture/bug-fix/decision/deployment/feature/governance/infra/invariant/judgment/nfr/small-change/technical/testing），**不含 `general`**。
- 仓库里没有别的迁移改这条约束；但 `packages/brain/scripts/smoke/notion-inlet-ingest-smoke.sh:26` 记录的线上白名单有 26 个值（含 `general`），说明线上约束是在迁移之外加宽过的（漂移）。
- 因此在「空库 + 跑全部迁移」的库上（CI `real-env-smoke` 用的 `cecelia_test`，见 `.github/workflows/ci.yml:1736` 起），不带 category 的 POST 会默认写 `general`，现在就直接 500。I-2 要求「按现有默认值写入，返回 201」，所以这个库上也要允许 `general`，见 S-2。

### S-1
对应：I-1、I-3

改动文件：`packages/brain/src/routes/strategic-decisions.js`（只改 POST 处理函数，加一个读允许值的小函数；GET/PUT 不动）

实现要点：
1. **允许值只认数据库一处**（INV-76cb816c：枚举不手抄副本）：新增 `loadAllowedCategories()`，执行
   `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'decisions'::regclass AND conname = 'decisions_category_chk'`，
   用正则 `/'([^']+)'::/g` 从 def 里抽出全部取值，去重后按字母排序返回数组。成功结果缓存在模块变量里；`loadAllowedCategories({ fresh: true })` 绕过缓存重查并刷新缓存。失败或查不到约束就返回 `null`，而且不缓存，下次请求再查。代码里不写死任何 category 列表。另导出仅供测试用的 `_resetAllowedCategoriesCache()`，清空模块缓存。
2. POST 在 topic/decision 必填校验和 status 校验之后、INSERT 之前，按顺序校验 category：
   - `category` 是 `undefined` / `null` / `''`：跳过校验，走原来的 `category || 'general'` 默认值（I-2 行为不变）。
   - `category` 不是字符串（数字、数组、对象、布尔）：返回 400。
   - 是字符串：取 `loadAllowedCategories()`。缓存数组含该值就放行；不含时先调 `loadAllowedCategories({ fresh: true })` 重读约束（防止线上用 psql 加宽约束后缓存过期，把数据库认可的值误拒），重读结果仍不含该值才返回 400；任一次返回 `null` 时放行，交给第 3 步兜底。
3. **兜底**：catch 里如果 `err.code === '23514' && err.constraint === 'decisions_category_chk'`，也返回同样形状的 400。这时 `allowed_categories` 再取一次；还是取不到就返回空数组，`error` 文案改为「category 非法」。其它错误照旧 500，不在本次范围。
4. 400 响应体固定为：
   ```json
   { "success": false, "error": "category 非法，合法值：architecture|bug-fix|decision|...", "allowed_categories": ["architecture", "bug-fix", "decision", "..."] }
   ```
   `error` 和 `allowed_categories` 都不能出现约束名 `decisions_category_chk`、`check constraint`、`violates`、`relation "decisions"` 等 SQL 原文。`console.error` 服务端日志可以照旧记 err.message。
5. 合法 category（如 `decision`、`judgment`）照原 SQL 写入，返回 201，响应体字段不变。

失败语义：400 是调用方的输入错，原样重试还会是 400；按 `allowed_categories` 改值后重发就能成功。被拒的请求不写任何行。

输入对抗面：
- 非法字符串（`workflow_bogus`）、大小写变体（`Decision`）、前后带空格（`" decision"`）、超长字符串（如 5000 字符）：都不在白名单里，返回 400。超长串不再走到数据库报 varchar 长度错，也不会 500。
- 非字符串类型（`123`、`["decision"]`、`{}`、`true`）：返回 400。
- 同一个非法请求重复发、并发发：每次都返回 400，不写库，没有副作用。每个非法请求多一次约束查询，刷新缓存是整体替换数组引用，并发不会读到半截状态。
- `''` / `null`：按「不带 category」处理（I-2）。

真实调用方 shape（发送方式都是 POST `/api/brain/strategic-decisions`，header 只有 `Content-Type: application/json`，没有鉴权头，body 是 JSON）：
- `packages/brain/scripts/coding-workflow/activities/spec-review.mjs:70-77`：`{ category:'judgment', topic, decision, reason, made_by:'ai', author:'coding-workflow', source_ref }`。`judgment` 在白名单里，行为不变。
- `apps/api/features/knowledge/pages/DecisionRegistry.tsx:74-78`：`{ topic, decision, reason, category:'general' }`。要靠 S-2 让 `general` 进白名单，才能继续 201。
- `packages/quality/tests/api/cross-package-integration.test.ts:175`：用 fetch 直接 POST。

验证：
- 新增单测 `packages/brain/src/routes/__tests__/strategic-decisions-category.test.js`。`beforeEach` 调 `_resetAllowedCategoriesCache()` 并重置 mock，保证用例间不共享缓存。用 mock pool，约束查询返回 `{ rows:[{ def: "CHECK (((category IS NULL) OR ((category)::text = ANY ((ARRAY['decision'::character varying, 'general'::character varying, 'judgment'::character varying])::text[]))))" }] }`。断言：
  - `category:'workflow_bogus'` → `res.status(400)`；`body.allowed_categories` 等于 `['decision','general','judgment']`；`JSON.stringify(body)` 不匹配 `/decisions_category_chk|check constraint|violates/i`；没有发出 INSERT。
  - `category:123` 和 `category:'x'.repeat(5000)` → 400，没有 INSERT。
  - `category:'decision'` → 发出 INSERT，参数含 `'decision'`，返回 201。
  - 缓存过期：先 POST `decision` 让旧列表进缓存；再把约束查询 mock 改成含 `'retro'` 的 def，POST `category:'retro'` → 发出约束重查和 INSERT，返回 201。
  - 兜底：约束查询抛错（返回 null，预检放行），POST `category:'workflow_bogus'`，INSERT 抛 `{ code:'23514', constraint:'decisions_category_chk', message:'new row for relation "decisions" violates check constraint "decisions_category_chk"' }` → 断言 INSERT 确实被调用过，返回 400，body 不含约束名和 SQL 原文。
- 回归：`packages/brain/src/routes/__tests__/strategic-decisions-source-ref.test.js`、`packages/brain/src/routes/strategic-decisions.test.js` 不改也要绿。mock 返回的 rows 里没有 def 时会解析成 `null` 并放行。
- 命令：`cd packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-category.test.js src/routes/__tests__/strategic-decisions-source-ref.test.js src/routes/strategic-decisions.test.js`，退出码 0。
- DevGate：`node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`，退出码 0。

### S-2
对应：I-2、I-3

改动文件：新增 `packages/brain/migrations/544_decisions_category_allow_general.sql`

这条迁移的理由：路由默认值 `general`（`strategic-decisions.js:95`）和 Dashboard 决策登记台显式传的 `general` 都不在迁移 384 的白名单里。在从迁移建出的库上（CI 空库、全新部署），I-2「不带 category 返回 201」不成立。只给白名单补 `general`，**不收窄任何现有取值**。

实现要点：
1. `BEGIN; SET LOCAL lock_timeout = '10s';`，接一个 `DO $$ ... $$` 块：
   - 读出当前 `decisions_category_chk` 的 `pg_get_constraintdef`，用 `regexp_matches(def, '''([^'']+)''::', 'g')` 抽出现有全部取值。约束不存在时，以迁移 384 的 13 个值为底。
   - 和 `{'general'}` 求并集，去重排序。
   - `ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_category_chk;`
   - 用 `EXECUTE format(...)` 重建：`CHECK (category IS NULL OR category IN (<并集>)) NOT VALID`。加 `NOT VALID` 是为了不扫描存量行，也就不会因为线上历史数据让迁移失败、Brain 起不来。新写入照样受约束。
2. `INSERT INTO schema_version (version, description) VALUES ('544', 'decisions_category_chk 补 general（只增不减）') ON CONFLICT (version) DO NOTHING; COMMIT;`
3. 幂等：重跑时并集不变，约束内容不变。线上已有的 26 个值（含 kr3-config/process/learning 等）全部保留。

验证（在 MMV 本机测试库上做，不碰生产）：
- `createdb cecelia_scratch_544 && DB_NAME=cecelia_scratch_544 node packages/brain/src/migrate.js` 成功后执行
  `psql -d cecelia_scratch_544 -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='decisions_category_chk'"`。
  断言输出同时含 `'general'`、`'nfr'`、`'judgment'`、`'testing'`。再跑一次 migrate，退出码 0，约束文本不变。
- 先手工把约束改成含 `'kr3-config'` 的宽版本，删掉 schema_version 里的 544 后重跑 migrate。断言 `'kr3-config'` 还在，即只增不减。验证完 `dropdb cecelia_scratch_544`。

## QA 场景

### Q-1
对应: I-1
前提: 预览环境 Brain 已启动（PR 预览环境，库由 staging 克隆并补跑了本 PR 的迁移）。本场景不依赖任何已有数据。
操作: `curl -s -w '\n%{http_code}' -X POST <预览环境>/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus","topic":"qa-bogus-<时间戳>","decision":"qa 非法 category"}'`
期望:
- HTTP 状态码 400。
- 响应 JSON 里 `success` 为 false，`error` 以「category 非法，合法值：」开头。
- `allowed_categories` 是非空数组，含 `decision`、`judgment`、`general`。
- 整个响应体（`grep -iE 'decisions_category_chk|check constraint|violates|relation'`）没有命中。
- 随后 `curl -s '<预览环境>/api/brain/strategic-decisions?category=workflow_bogus&limit=10'` 返回的 `data` 是空数组，即没有写入任何行。

### Q-2
对应: I-1
前提: 同 Q-1。
操作: 依次 POST 三个边界请求（topic 各带时间戳）：
- ① `"category":123`
- ② `"category":"Decision"`（大小写变体）
- ③ `category` 为 5000 个 `a` 的字符串（用 `python3 -c` 生成 body）

另外把 ① 原样连发 3 次。
期望: 全部返回 HTTP 400，不出现 500。每个响应都带 `allowed_categories` 数组，且都没有约束名或 SQL 原文。重复发送每次结果一样。用 GET `?category=Decision` 查，`data` 为空。

### Q-3
对应: I-2
前提: 同 Q-1。
操作: `curl -s -w '\n%{http_code}' -X POST <预览环境>/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"topic":"qa-nocat-<时间戳>","decision":"qa 不带 category"}'`；再发一条 `"category":""` 的同类请求（topic 用另一个时间戳）。
期望:
- 两条都返回 HTTP 201，`success` 为 true，`data.category` 为 `general`，`data.topic` 和传入的一致。
- `curl -s '<预览环境>/api/brain/strategic-decisions?category=general&limit=200'` 的 `data` 里能按 topic 找到这两条。

### Q-4
对应: I-3
前提: 同 Q-1。
操作:
- `curl -s -w '\n%{http_code}' -X POST <预览环境>/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"decision","topic":"qa-decision-<时间戳>","decision":"qa 合法 category"}'`
- 然后 `curl -s '<预览环境>/api/brain/strategic-decisions?category=decision&limit=200'`

期望:
- POST 返回 HTTP 201，`data.category` 为 `decision`，`data.id` 非空。
- GET 返回的 `data` 里有一条 `id` 等于这个 id、`topic` 等于 `qa-decision-<时间戳>` 的记录，`category` 为 `decision`。

### Q-5
对应: I-3
前提: 同 Q-1。
操作: 按真实调用方 coding-workflow 合同对抗写判定点的 shape（`spec-review.mjs:70-77`）发请求：POST `<预览环境>/api/brain/strategic-decisions`，body 为 `{"category":"judgment","topic":"判定点[qa<时间戳>#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","made_by":"ai","author":"coding-workflow","source_ref":"coding-workflow:qa-<时间戳>"}`。然后 GET `?category=judgment&limit=1000`。
期望: POST 返回 201。GET 能按 topic 找到这条，`category` 为 `judgment`。原有调用方没有被新校验误伤。

## 铁律对照

- INV-76cb816c：S-1 覆盖。category 允许值只从数据库约束 `decisions_category_chk` 实时读取，代码里不手抄白名单副本，消除路由和数据库两份枚举分叉的隐患。
- INV-ae4b4428：S-1、Q-1、Q-2 覆盖。校验是写库前的内联判断和拦截，判不过直接 return 400，不进 INSERT；不是靠事后探针。
- INV-e9c7752f：S-1 覆盖。`loadAllowedCategories()` 失败时返回 null 而不是抛错，调用处显式处理 null 分支（放行，并由 23514 兜底转 400），不只依赖外层 try/catch。
- INV-564802ee / INV-459b6ff9：S-1 覆盖。400 响应不透出数据库内部信息。本次不新增日志字段，不涉及凭据或 PII。
- INV-52f1801e：S-1 覆盖。只跑 vitest 和 DevGate；需要装依赖时只在仓库根执行 `npm ci --legacy-peer-deps --ignore-scripts`。
- INV-f437b0fd：S-2 覆盖。迁移验证的写入和校验都用同一个 `cecelia_scratch_544` 库名变量，不触碰生产库。
- INV-96054a8b / INV-95477a66：S-2、Q-1~Q-5 覆盖。验证和 QA 只在 MMV 本机测试库与 PR 预览环境做；us-vps 只承载部署后的 Brain 进程，不在其上执行验证负载。
- INV-be038f9e：S-2 覆盖。约束变更走迁移文件持久化，下次部署或新建库得到同样结果。没有改环境变量或部署配置。
- INV-761f242b：不适用：本次没有「先查状态再更新」的幂等逻辑。迁移幂等靠 DROP IF EXISTS 加并集重建，在单事务内完成。
- INV-d976752e：S-1 覆盖。超长 category 在写库前就被白名单拦下返回 400，不会撞 varchar(50) 变成 500。
- INV-50954d28：不适用：本次不新增端点，只收紧既有端点的输入校验；该端点缺鉴权属于存量问题，见「未覆盖真实链路」。
- INV-3c30394c：Q-1~Q-5 覆盖。接缝（真实数据库约束和真实 HTTP 调用）在预览环境真库上验证。
- INV-1129ee0d：不适用：不涉及权限、资金、外部发布；只改 decisions 表的 category 白名单（只增不减），不改生产数据内容。

## 未覆盖真实链路

- 线上（us-vps 生产）约束的真实内容没有直接读取验证：按 `notion-inlet-ingest-smoke.sh:26` 推断已含 `general`，迁移 544 用「只增不减」的并集写法规避风险。QA 只验到预览环境（staging 克隆库）这一层。
- Dashboard 决策登记台（`DecisionRegistry.tsx`）提交后不看返回状态，即使收到 400 也会静默关闭弹窗。页面没有做 UI 层验收，只按它的真实 body shape 在 Q-3 里做了接口层验证。改善前端错误提示建议另立任务。
- 该端点没有鉴权（INV-50954d28），GET/PUT 的 500 也照样透出 `err.message`，PUT 没有校验 status。这些都是需求外的存量问题，本次不动，建议另立任务。
- `spec-review.mjs` 的 `brainJson` 写判定点时是否检查 HTTP 状态，不在本次范围，建议另立任务核查。

## 判定点

- category 允许值来源｜候选: 代码硬编码常量 / 运行时读数据库约束定义 / 只捕获 23514 事后转译｜所选: 运行时读 `pg_get_constraintdef` 为主，23514 转译兜底｜依据: 线上约束已经和迁移漂移（26 值和 13 值），硬编码必然和某个环境不一致；读真身最准，兜底保证解析失败时也不会 500 透出原文｜误判后果: 解析出错漏掉某值时，合法值会被误拒 400（调用方写不进）；兜底只防住 500 透出，误拒要靠 Q-4、Q-5 发现
