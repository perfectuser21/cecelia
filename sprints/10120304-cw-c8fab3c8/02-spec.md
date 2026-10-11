---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2"]
---
# 实现规格：decisions_made_by_check 只增不减补 ai

现状（代码事实）：
- `decisions.made_by` 的唯一约束来自 `packages/brain/migrations/193_knowledge_doc_author.sql:9-10`（列级 CHECK，PG 自动命名 `decisions_made_by_check`，取值 `user/cecelia/system`），之后无迁移改过它。
- `POST /api/brain/strategic-decisions`（`packages/brain/src/routes/strategic-decisions.js:152-190`）对 made_by 无应用层校验，约束违规落到 `:188` 的通用 500，响应体透出 `violates check constraint "decisions_made_by_check"`。
- 迁移编号当前最大 551，下一个空闲为 552（撤回提交 b7ec64115 用的 546 已被 `546_runs_terminal_span.sql` 占用，不可复用）。

### S-1
- 对应：I-1、I-2
- 改动文件：新增 `packages/brain/migrations/552_decisions_made_by_allow_ai.sql`（若开工时 552 已被 main 占用，顺延到下一个空闲编号，并同步本规格内所有 552 引用的文件名/测试名）。
- 内容（照 `545_decisions_category_allow_general.sql` 的并集重建写法）：
  - `BEGIN; SET LOCAL lock_timeout = '10s';`
  - DO 块：**按列而非按约束名**查找——从 `pg_constraint` 取 `conrelid='decisions'::regclass AND contype='c'` 且 `conkey` 含 `made_by` 列 attnum 的全部 CHECK 约束（不论名字，防生产在迁移外改过名或另加过约束）。
    - 若其中有多列 CHECK（`conkey` 不止 made_by 一列）→ `RAISE EXCEPTION`，事务回滚、552 不落 schema_version（宁可部署时报错，也不留一个照样拒 ai 的约束）。
    - 对每个单列 CHECK 用 `regexp_matches(def, '''([^'']+)''::', 'g')` 抽取值；某个定义非空却抽不出值（非 IN/ANY 形态）→ 同样 `RAISE EXCEPTION`。
    - 一个都没有时以 `ARRAY['user','cecelia','system']` 为底；否则取所有约束取值的并集（覆盖 193 三值与迁移外加宽的取值）。
  - 与 `ARRAY['ai']` 求并集去重排序，逐个 `DROP CONSTRAINT` 上一步找到的全部 made_by 单列 CHECK，再用 `format(... quote_literal ...)` 重建唯一一个 `decisions_made_by_check CHECK (made_by IN (...)) NOT VALID`。
  - 不动列类型（`VARCHAR(20)`，'ai' 长度足够）、不动默认值 `'system'`、不改任何存量行。
  - 末尾 `INSERT INTO schema_version (version, description) VALUES ('552', 'decisions_made_by_check 补 ai（只增不减）') ON CONFLICT (version) DO NOTHING; COMMIT;`
- 不新增 rollback 文件（只放宽约束，回滚即收窄，违背 I-2「只增不减」）。
- `EXPECTED_SCHEMA_VERSION`（`packages/brain/src/selfcheck.js:28`，最低版本语义 '430'）不改；`scripts/facts-check.mjs` 只校验它不超过最大迁移号，不受影响。
- 失败语义：迁移失败时整个事务回滚、`schema_version` 不写 552，Brain 启动时 migrate 报错并下次重试；`lock_timeout=10s` 防止在生产大表锁上无限等待。
- 输入对抗面：重复执行（migrate 跳过已记录版本；即使手工重跑，并集结果不变）——幂等；现有约束含迁移外取值——全部保留；约束被改名/另有同列约束——全部并入后收敛为一个；多列或无法解析的 made_by 约束——报错回滚不静默；约束被人删掉过——以 193 三值为底重建并补 ai。
- 验证：
  - `node scripts/facts-check.mjs` 通过；`bash scripts/check-version-sync.sh` 通过；CI `lint-migration-unique-version` 通过（编号不重复）。
  - S-2 的集成测试全绿。

### S-2
- 对应：I-1、I-2
- 改动文件：新增 `packages/brain/src/__tests__/integration/migration-552-decisions-made-by-ai.pg.integration.test.js`（写法照 `migration-542-coding-workflow-activities.pg.integration.test.js`：去掉 BEGIN/COMMIT 行读迁移正文，事务内执行，最后整体 ROLLBACK；库名守卫只允许 `cecelia_scratch` 或 `CI=true` 时 `cecelia_test`）。
- 断言（全部在同一事务内）：
  1. 预置「迁移外加宽」形态：先把 `decisions_made_by_check` 重建为 `('user','cecelia','system','owner_x')`，跑迁移正文 → `pg_get_constraintdef` 同时含 `'user'`、`'cecelia'`、`'system'`、`'owner_x'`、`'ai'`（只增不减）。
  2. 再跑一遍迁移正文 → 约束定义字符串与第一遍完全相同（幂等）。
  3. 约束不存在时（先 DROP）跑迁移正文 → 重建出 `user/cecelia/system/ai` 四值。
  4. 改名/多约束形态：DROP 后另建 `decisions_made_by_legacy_chk CHECK (made_by IN ('user','cecelia','system','owner_y'))` → 跑迁移正文 → decisions 上涉及 made_by 的 CHECK 只剩一个且名为 `decisions_made_by_check`，含 `owner_y` 与 `ai`。
  5. 多列 CHECK 形态：另建 `CHECK (made_by <> 'ai' OR category IS NOT NULL)` 这类多列约束 → 跑迁移正文抛异常（包在 SAVEPOINT 内，捕获后 `ROLLBACK TO SAVEPOINT` 再继续）。
  6. `INSERT INTO decisions (topic, decision, category, made_by, ...) VALUES (..., 'judgment', 'ai')` 成功；`made_by='bogus'` 仍抛 23514（约束仍在、未被放成全开）——bogus 插入包在 `SAVEPOINT` 内，报错后 `ROLLBACK TO SAVEPOINT` 再做后续断言，避免事务被置为 aborted。
  7. `made_by` 列默认值仍为 `'system'`、类型仍为 `character varying(20)`。
- 验证命令：`cd packages/brain && DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-552-decisions-made-by-ai.pg.integration.test.js` 退出码 0。

### S-3
- 对应：I-1
- 改动文件：`packages/brain/scripts/smoke/strategic-decisions-category-smoke.sh`（已在 `packages/quality/smoke-allowlist.txt:433` 与 `smoke-write-targets.txt:138` 登记，无需新增登记）。
- 改动：
  - 第 4 段循环由 `for MB in system` 改为 `for MB in system ai`，断言文案同步为「made_by=system/ai」；头注释补一句「迁移 552 让 made_by=ai 进 decisions_made_by_check」。
  - 第 1 段（`DATABASE_URL` 存在时）追加：`decisions_made_by_check` 定义同时含 `'user'`、`'cecelia'`、`'system'`、`'ai'`。
  - 生产保护 guard（`smoke-production-guard.mjs`，未授权 exit 0）保持原样不动。
- 真实调用方 shape：coding-workflow 判定点写入方 `packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75` —— `POST {BRAIN}/api/brain/strategic-decisions`，`Content-Type: application/json`，无鉴权头，body 字段 `category:'judgment'`、`topic:'判定点[<task>#n]: <名>'`、`decision`、`reason`、`made_by`、`author:'coding-workflow'`、`source_ref:'coding-workflow:<taskId>'`。main 现行写 `made_by:'system'`；本任务按 I-1 让同一 shape 的 `made_by:'ai'` 也能写入（是否把 spec-review.mjs 改回 ai 不在本次范围，见「未覆盖真实链路」）。
- 失败语义：made_by 取约束外的值仍是 500 透出约束原文（存量行为，不在本次范围）；ai 写入成功返回 201 + `data.made_by='ai'`，调用方可按 topic 去重后重试。
- 输入对抗面：同 topic 重复 POST 会写两行（路由无去重，存量行为）；smoke 用带时间戳的唯一 topic 避免互踩。
- 验证：CI real-env-smoke job（`cecelia_test` 空库，`node src/migrate.js` 从零建库后跑 smoke）中该脚本输出 `PASS: coding-workflow 判定点（made_by=system/ai）201 且可查`，退出码 0。

### S-4
- 对应：I-1、I-2
- 改动文件：新增 `changes/<分支名>.md` 版本碎片（格式照 `changes/cp-10120045-route-table-gate.md`：`## Brain {VERSION} — decisions_made_by_check 补 ai（只增不减）` + 2~3 条要点：迁移 552 并集重建、保留迁移外取值、NOT VALID 不扫存量）。
- 验证：`bash scripts/check-version-sync.sh` 通过；`ls changes/` 可见新碎片。

## QA 场景

### Q-1
- 对应: I-1
- 前提: 执行地二选一，下文 `<BRAIN>` 指所选地址：
  - 优先：本 PR 的预览环境 Brain（Deploy Preview Environment 检查为绿且有预览 URL，库跑过迁移 552）。
  - 兜底（预览检查红/无 URL 时，见 INV-909ce765）：本机从本 PR 分支起隔离 Brain，`<BRAIN>=http://localhost:5299`：
    ```
    cd packages/brain
    DB_NAME=cecelia_scratch node src/migrate.js            # 退出码 0，schema_version 含 552
    DB_NAME=cecelia_scratch PORT=5299 node server.js &      # DB_NAME 含 scratch → runtime-safety.js:9 判为隔离实例，无后台调度/模型调用
    curl -s http://localhost:5299/api/brain/health | jq '.runtime.isolated'   # 必须为 true，否则停止
    ```
    写入（curl 到 `<BRAIN>`）与核对（psql `cecelia_scratch`）指向同一 scratch 库（INV-f437b0fd）；禁止用 `localhost:5221`（生产代理）。
  - 无需预置数据。
- 操作:
  1. `curl -s -w '\n%{http_code}' -X POST <BRAIN>/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"judgment","topic":"判定点[qa-c8fab3c8-<时间戳>#1]: 部署判定","decision":"所选: 健康检查｜候选: 健康检查/日志","reason":"依据: 双信号","made_by":"ai","author":"coding-workflow","source_ref":"coding-workflow:qa-c8fab3c8-<时间戳>"}'`
  2. `curl -s '<BRAIN>/api/brain/strategic-decisions?category=judgment&limit=1000'`，在 `data` 里按第 1 步的 topic 过滤。
- 期望: 第 1 步 HTTP 201，响应 `success:true`、`data.made_by:"ai"`、`data.category:"judgment"`，响应体不含 `decisions_made_by_check` / `violates check constraint`；第 2 步恰好 1 行 topic 相同且 `made_by:"ai"`、`author:"coding-workflow"`。

### Q-2
- 对应: I-1
- 前提: 同 Q-1。
- 操作: 按 Q-1 第 1 步同样的 body，把 `made_by` 分别换成 `system`、`user`、`cecelia`（topic 各带不同后缀）各 POST 一次，再 GET `?category=judgment&limit=1000` 按 topic 过滤。
- 期望: 三次都是 201，查回各 1 行且 made_by 与提交值一致（加 ai 没有挤掉原有取值）。

### Q-3
- 对应: I-1、I-2
- 前提: 同 Q-1。
- 操作: 按 Q-1 第 1 步 body，`made_by` 换成 `bogus_maker`（topic 带唯一后缀）POST；再 GET `?category=judgment&limit=1000` 按该 topic 过滤。
- 期望: 非 201（存量行为为 500，`success:false`）；查回 0 行——约束仍然生效，没有被放成任意值可写。

### Q-4
- 对应: I-1
- 前提: 同 Q-1。
- 操作: 同一个 Q-1 body（同 topic）连续 POST 两次，made_by=ai。
- 期望: 两次都 201（重复操作不报约束错）；GET 按 topic 查回 2 行，均 `made_by:"ai"`（路由不去重为存量行为，本场景只验证 ai 写入稳定可重复）。

### Q-5
- 对应: I-2
- 前提: QA 本机隔离库 `cecelia_scratch`（不得用生产库，不得用 `localhost:5221`）；从本 PR 分支 checkout。
- 操作:
  1. `psql cecelia_scratch -c "ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_made_by_check; ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system','qa_extra')) NOT VALID; DELETE FROM schema_version WHERE version='552';"`（造出「迁移外加宽 + 552 未跑」的状态）
  2. `cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js`
  3. `psql cecelia_scratch -Atc "SELECT c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by'"`，记为 D1。
  4. `psql cecelia_scratch -c "DELETE FROM schema_version WHERE version='552';"` 后再跑一次第 2 步，再取一次约束定义记为 D2；并 `psql cecelia_scratch -Atc "SELECT count(*) FROM schema_version WHERE version='552'"`。
- 期望: D1 恰 1 行、名为 `decisions_made_by_check`，定义同时含 `'user'`、`'cecelia'`、`'system'`、`'qa_extra'`、`'ai'`；D2 与 D1 字符串完全相同（重跑幂等）；schema_version 中 552 恰 1 行；两次 migrate 均退出码 0。

### Q-6
- 对应: I-2
- 前提: QA 本机隔离库 `cecelia_scratch`，已跑过本分支 migrate。
- 操作: `psql cecelia_scratch -Atc "SELECT data_type, character_maximum_length, column_default FROM information_schema.columns WHERE table_name='decisions' AND column_name='made_by'"`；再 `psql cecelia_scratch -c "INSERT INTO decisions (topic, decision, category) VALUES ('qa-default-c8fab3c8-<时间戳>','x','judgment') RETURNING made_by"`。
- 期望: 列仍为 `character varying|20|'system'::character varying`；不带 made_by 插入返回 `system`（默认值未被改）。

### Q-7
- 对应: I-2
- 前提: 生产库真库只读验收。执行地 MMV 本机，经已有 pg-tunnel `localhost:15432` 连 us-vps 生产 `cecelia`（DEFINITION.md:1095 同一通道）；只发 SELECT，会话强制只读，不在 us-vps 上起任何进程（INV-96054a8b）。查询记为 `$Q`：
  ```
  PGOPTIONS='-c default_transaction_read_only=on' psql -h localhost -p 15432 -d cecelia -Atc "SELECT c.conname, pg_get_constraintdef(c.oid), array_length(c.conkey,1) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by'"
  ```
- 操作:
  1. 合并前跑 `$Q`，结果存为 D0（列出所有涉及 made_by 的 CHECK，不限约束名）。
  2. 部署后先确认 `... -Atc "SELECT count(*) FROM schema_version WHERE version='552'"` 为 1，再跑 `$Q` 存为 D1。
- 期望: D0 若含多列约束或无法解析的定义，合并前即判本规格不成立、退回 S-1（不进入部署）；D1 恰 1 行、名为 `decisions_made_by_check`、`array_length=1`，取值集合 ⊇ D0 全部约束取值 ∪ {`ai`}——没有任何迁移外取值丢失，也没有别的约束仍会拒 ai。

## 铁律对照

- INV-45cd3ec2：S-3、Q-1 覆盖——只扩展现有 smoke 的断言，保留 `smoke-production-guard.mjs` 未授权 exit 0 且不发请求的仓库约定。
- INV-ff177feb：不适用：该决策已被 INV-45cd3ec2 撤销，按现行口径执行。
- INV-f437b0fd：S-3 覆盖——smoke 写入（curl 到 BRAIN_URL）与约束校验（psql DATABASE_URL）沿用同一 guard 核对二者指向同一安全库，不各自默认。
- INV-6d11717d：S-3 覆盖——约束断言在 `DATABASE_URL` 存在时硬 `fail`（exit 1），不静默跳过；CI real-env-smoke 注入 DATABASE_URL。
- INV-761f242b：不适用：本改动是约束 DDL，不涉及「SELECT 判态再 UPDATE」的状态幂等。
- INV-052e10a0：S-3 覆盖——已全仓 grep made_by 取值枚举（代码仅 user/cecelia/system，约束只在 193 一处定义）；测试替身 `spec-review.test.mjs:211` 的三值白名单与 `harness-contract-reviewer/SKILL.md:468` 的说明为既有描述，登记在「未覆盖真实链路」建议另立任务同步。
- INV-76cb816c：不适用：本次不新增应用层 made_by 常量，取值真身仍是 DB 约束。
- INV-3efefc23：S-3 覆盖——brain 改动带 smoke，且复用已登记 allowlist 的脚本。
- INV-1100cb8f：S-3 覆盖——不改 `.github/workflows/*.yml` 与 `smoke-allowlist.txt`，只改已登记脚本本体。
- INV-c906dd6c：S-2 覆盖——验证命令走 `vitest.integration.config.js` 并指定 `src/__tests__/integration/` 下路径（include 范围内），不指向 sprints/**。
- INV-be038f9e：S-1、Q-5 覆盖——约束变更以迁移文件持久化（每次部署/新库 migrate 都会得到同一结果），Q-5 同时验证运行时约束定义。
- INV-5e125909：S-1 覆盖——不写死「线上只有三值」的假设，从 `pg_constraint` 现读现有取值求并集。
- INV-96054a8b：Q-5、Q-6、Q-7 覆盖——QA 在本机 `cecelia_scratch` 与预览环境执行；Q-7 仅从 MMV 经 pg-tunnel 发只读 SELECT，不在 us-vps 上跑任何验证负载。
- INV-909ce765：Q-1 覆盖——Deploy Preview Environment 跨 PR 失败为既有 infra 故障，Q-1~Q-4 写明本机 `cecelia_scratch` 隔离 Brain（端口 5299）兜底，不依赖预览环境可用。
- INV-95477a66：不适用：本改动不在 us-vps 执行任何推理/重活，迁移随 Brain 正常部署自动执行。
- INV-50954d28：不适用：不新增/修改端点，`/api/brain/strategic-decisions` 鉴权现状不变。
- INV-1129ee0d：不适用：迁移只放宽 decisions.made_by 一个取值、不改存量数据，不触及权限/资金/外部发布；生产数据写入仅为约束 DDL，QA 对生产只做 Q-7 只读查询（`default_transaction_read_only=on`）。
- INV-52f1801e：不适用：不涉及依赖安装。
- INV-0dc6b84f / INV-91e9abe3：不适用：本次不涉及执行地与模型选择，只是 DB 约束迁移。
- INV-dc18d43d：S-1 覆盖——判定点落库成败由 DB 约束机械判定，不依赖 LLM 自觉选 made_by 值。

## 未覆盖真实链路

- 真实调用方 `spec-review.mjs:75` 现行写 `made_by:'system'`，本次不改回 `ai`；QA 只验到「ai shape 写入可 201 且可查」，未验 coding-workflow 真跑一轮写出 ai 判定点。是否改回 ai 属需求外，建议另立任务。
- 测试替身 `packages/brain/scripts/coding-workflow/__tests__/spec-review.test.mjs:210-213` 仍按三值模拟约束、`packages/workflows/skills/harness-contract-reviewer/SKILL.md:468` 仍写「'ai' 会被 DB 拒」：与迁移后真身不一致，属需求外存量描述，建议另立任务同步。
- POST 遇非法 made_by 仍返回 500 并透出约束原文（未转 400）：需求外存量行为，建议另立任务。
- 预览环境库为克隆库，是否「从零迁移建出」取决于预览部署实现；「空库从零 migrate」由 CI real-env-smoke（`cecelia_test`）覆盖，QA 在预览环境/本机 scratch 只验到接口层；生产真实形态由 Q-7 只读前后对比覆盖。

## commander 裁决（第 1 次）

### 裁决 T-7（覆盖 Q-7，qa_cannot_verify）：采纳——Q-7 原写法 QA 不可执行，改为可验做法
- 理由：Q-7 要求 QA 连 us-vps 生产库（pg-tunnel `localhost:15432`），与 QA 禁令「只能访问 PREVIEW_URL，绝不访问生产地址，只读也不行」直接冲突；且「部署后 D1」在合并前的 QA 门里按定义取不到。这是 Q-7 写法问题，不是环境缺工具。
- I-2 的「真库验收」由下列三者共同兜住，不依赖 QA 直连生产：
  1. S-1 的失败语义：生产若存在多列 / 无法解析的 made_by CHECK，迁移 552 `RAISE EXCEPTION` 整体回滚、不写 schema_version——不会静默留下拒 ai 的约束，也不会丢迁移外取值（S-2 断言 1/4/5 + Q-5 已在本机证实）。
  2. 预览库是生产克隆，跑过 552 后的约束形态即「生产数据形态 + 本迁移」的真实结果。
  3. 部署后生产核对归部署后流程（Brain 启动 migrate 失败即报错重试 + selfcheck），不属于合并前 QA 门。

补充 Q-7'（替代 Q-7 作为 QA 门判定依据；Q-7 原文保留为部署后人工/流程参考，不计入 QA verdict）：
- 对应: I-2
- 前提: 本 PR 预览环境（生产克隆库，已跑迁移 552）；只发 SELECT；禁止连 `localhost:15432` / `localhost:5221` 或任何生产地址。
- 操作:
  1. 对预览环境 Brain 所连的库执行 Q-7 中的 `$Q` 查询（同一 SQL，`pg_constraint` 按列查 made_by 的全部 CHECK，含 `array_length(c.conkey,1)`），记为 DP。
  2. 同库执行 `SELECT count(*) FROM schema_version WHERE version='552'`。
  3. 同库执行 `SELECT DISTINCT made_by FROM decisions`，记为 V（克隆自生产的存量取值）。
- 期望: 第 2 步为 1；DP 恰 1 行、名为 `decisions_made_by_check`、`array_length=1`，定义同时含 `'user'`、`'cecelia'`、`'system'`、`'ai'`，且 V 中每个非空取值都出现在定义里（存量取值无一被新约束排除——只增不减）。
- 若 QA 无法取得预览库的只读连接：以预览 Brain 对 Q-1~Q-3 的接口结果 + Q-5 本机结果判 PASS，并在报告中注明 DP 未取得，不判 CANNOT_VERIFY。
