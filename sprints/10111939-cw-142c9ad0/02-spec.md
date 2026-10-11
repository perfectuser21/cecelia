---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: spec
upstream: ["01-intent.md#I-1","01-intent.md#I-2","01-intent.md#I-3","01-intent.md#I-4","01-intent.md#I-5"]
---
# 实现规格：内容流水线 /:id 子路由不再吞掉 /api/brain/runs/*，非 uuid id 不再 500

## 现状（代码证据）

- `packages/brain/server.js:430-431`：同一个 `contentPipelineRoutes` 挂了两次：`/api/brain/pipelines` 和 `/api/brain`（后者是给 `/api/brain/content-types` 用的别名挂载）。
- `packages/brain/src/routes/content-pipeline.js` 的 `GET /:id/stages`(546)、`/:id/output`(584)、`/:id/publish-status`(686)、`/:id/stats`(922) 在别名挂载下会匹配 `/api/brain/runs/stats` 等路径（id=`runs`），把 `runs` 当 uuid 去查 PG，抛 `invalid input syntax for type uuid` 后以 500 回显 `err.message`。
- runs 读路由 `createRunsReadRouter()` 挂在 `server.js:477`（`/api/brain/runs`），比别名挂载晚，所以永远轮不到它。
- 已核对：`packages/brain/src/routes` 下没有别的 `/:x/:y` 双段通配，431 与 477 之间也没有别的路由会接走 `/runs/<段>`。

## 规格

### S-1
对应：I-1、I-2

改动文件：`packages/brain/src/routes/content-pipeline.js`

- 新增一个模块内函数 `guardPipelineId(req, res, next)`（只在本文件内使用，不导出）：
  - `req.params.id` 符合 UUID 格式（`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`）→ 返回 `true`，handler 照原逻辑继续。
  - 不是 UUID，且 `req.baseUrl === '/api/brain'`（别名挂载）→ 调 `next('router')` 退出整个内容流水线路由，交给 server.js 后面挂载的路由（`/api/brain/runs` 的 runs 读路由等）处理，返回 `false`。
  - 不是 UUID，其他挂载（`/api/brain/pipelines`）→ `res.status(400).json({ error: 'invalid pipeline id: must be a UUID' })`，返回 `false`；body 里只放这一句固定文本，不带 PG 错误。
- 只在 `GET /:id/stages`、`GET /:id/output`、`GET /:id/publish-status`、`GET /:id/stats` 这 4 个 handler 的第一行调用：handler 签名加 `next`，`if (!guardPipelineId(req, res, next)) return;`。其余 `/:id` 路由（`POST /:id/run`、`PATCH /:id`、`POST /:id/approve`、`POST /:id/pre-publish-check`）不改（不在 I-n 范围，见「未覆盖真实链路」）。
- 不用 `router.param('id', …)`：它会作用到上面那 4 条不在范围内的写路由，等于扩大需求。
- 文件头注释里的路由表不改；在 `guardPipelineId` 上方加一行注释，说明为什么别名挂载下要放行（`/api/brain/runs/stats` 等）。

失败语义：
- `/api/brain/pipelines/<非uuid>/{stats|stages|output|publish-status}` → 400 `{"error":"invalid pipeline id: must be a UUID"}`，属于确定性的客户端错误，原样重试结果一样。
- `/api/brain/<任意非uuid段>/{stats|stages|output|publish-status}` → 不再由内容流水线处理，交给后续路由；`runs` 段由 runs 读路由按 run_id 处理（S-2）。没有后续路由接的，走 Express 全局 404。

输入对抗面：
- 大写 UUID：正则带 `i`，按合法 id 照常处理。
- 空格、URL 编码的垃圾值、超长串、SQL 片段（如 `1' OR '1'='1`）：都不是 UUID，在 `/pipelines` 下统一 400，不进 PG。
- 重复、并发请求：guard 是纯函数判定，没有状态，不受影响。

验证：
- 新增回归测试 `packages/brain/src/__tests__/content-pipeline-runs-shadow.test.js`（vitest + supertest，mock `../db.js` 的 `pool.query`/`pool.connect`）。按 server.js 的挂载顺序拼一个 express app：`/api/brain/pipelines` → contentPipelineRouter，`/api/brain` → contentPipelineRouter，`/api/brain/runs` → `createRunsReadRouter({ pool: mockPool })`。测试进程里不设 `CECELIA_INTERNAL_TOKEN`，supertest 走 loopback 鉴权。断言：
  1. `GET /api/brain/runs/stats|stages|output|publish-status` 四条都返回 404，`body.error === 'run not found: <段名>'`；mock 断言 runs 读路由那条 SQL `SELECT * FROM runs WHERE run_id = $1` 被调用，参数是 `[<段名>]`；内容流水线的 SQL（`pipeline_publish_stats`、`parent_pipeline_id`、`publish_results`、`FROM tasks WHERE id`）一次都没被调用。
  2. `GET /api/brain/pipelines/not-a-uuid/{4 个子路径}` 都返回 400，`body.error` 不包含 `invalid input syntax`，`pool.query` 没被调用。
- 按 Bug 修复流程：这个测试先单独提交、确认是红的（改动前 4 条 `/runs/*` 拿到的是 500 或内容流水线的响应），再提交实现转绿。测试永久留在仓库里。
- 命令：`cd packages/brain && npx vitest run src/__tests__/content-pipeline-runs-shadow.test.js`，退出码 0。

### S-2
对应：I-1、I-5

改动文件：无（`packages/brain/src/routes/runs-read.js`、`packages/brain/server.js` 都不改）。

- S-1 放行以后，`/api/brain/runs/{stats|stages|output|publish-status}` 自然落到 `server.js:477` 的 runs 读路由 `GET /:run_id`：存在就 200 返回 runs 行，不存在就 404 `{"error":"run not found: <run_id>"}`；鉴权照旧是 `internalAuthOrLoopback`。
- `GET /api/brain/runs/:run_id`（含 `coding-workflow:<uuid>` 这种带冒号的 run_id）以及 `?include=spans` 不经过内容流水线（两段以内的路径里没有 `stats/stages/output/publish-status` 后缀），逻辑和代码都不变。
- 真实调用方 shape（I-5）：coding-workflow runner 用 `POST /api/brain/spans` 上报，header 带 `content-type: application/json`、`x-session-id: coding-workflow-runner`，配了 token 时再加 `x-internal-token`；body 是 span 数组，字段有 `run_id/activity_id/occurrence_key/started_at/ended_at/executor_kind/outcome/...`（出处：`packages/brain/scripts/coding-workflow/runner/lib/brain.mjs`；同样的请求写法见 `packages/brain/scripts/smoke/runs-read-smoke.sh:22-24`）。读的时候用 `GET /api/brain/runs/<encodeURIComponent(run_id)>[?include=spans]`。

验证：
- 在 S-1 那个测试文件里加断言：`GET /api/brain/runs/coding-workflow%3A<uuid>` 走 runs 读路由，mock 命中返回 200 和行数据；`?include=spans` 走 `pool.connect` 事务分支，返回带 `spans` 数组的 200。
- 现有 runs 读测试照常绿：`cd packages/brain && npx vitest run src/__tests__/runs-read-smoke-guard.test.js`。

### S-3
对应：I-3、I-4

改动文件：`packages/brain/src/__tests__/content-pipeline-routes.test.js`、`packages/brain/src/__tests__/content-pipeline-publish-status.test.js`（只改测试里的 id 写法）。

- 现有用例里 `GET /api/brain/pipelines/pipe-1/stages`（routes.test.js:249/270/292）和 publish-status.test.js 里 `mockReqRes({ id: 'pipe-1' })` 这类非 UUID 测试 id，统一换成固定的合法 UUID（例如 `11111111-1111-4111-8111-111111111111`），对应的 `pipeline_id` 期望值也同步改掉。断言的业务逻辑（合并规则、阶段字段）一条都不改。publish-status.test.js 里直接调 handler 的写法给 `req` 补 `baseUrl: '/api/brain/pipelines'`，再传一个 `next` 桩。
- `POST /:id/run`、`PATCH /:id`、`POST /:id/approve` 的用例（`pipe-1`/`missing`）不受影响，不改。
- 在 S-1 新测试里补 I-4 断言：`GET /api/brain/content-types` 走别名挂载返回 200（mock `listContentTypes`）；`GET /api/brain/content-types/<type>/config` 不被 guard 拦截（不是 `/:id/<4 个后缀>` 形态）。
- 合法 UUID 原有行为（I-3）：新测试里 `GET /api/brain/pipelines/<uuid>/stats` mock 返回一行，得到 200，`body.pipeline_id === <uuid>`；别名挂载下 `GET /api/brain/<uuid>/stages` 也照旧由内容流水线返回 200（别名下的合法 UUID 行为不变）。

验证：
- `cd packages/brain && npx vitest run src/__tests__/content-pipeline-routes.test.js src/__tests__/content-pipeline-publish-status.test.js src/__tests__/content-pipeline-trigger-topics.test.js src/__tests__/content-pipeline-runs-shadow.test.js`，退出码 0。
- DevGate（Brain 改动强制）：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 全部退出码 0。版本号不手动 bump，合并后由 auto-version 处理。

## QA 场景

约定：`$B` = `<预览环境>`；预览环境配了 `CECELIA_INTERNAL_TOKEN` 时，每个请求都带 `-H "x-internal-token: $CECELIA_INTERNAL_TOKEN"`（runs 读路由要鉴权）；没配 token 时必须在 Brain 本机经 loopback 发请求，`/api/brain/runs/*` 拿到 503 记为「环境前提不满足」，不算产品失败（`internal-auth.js:74-77`）。所有写操作只打预览环境，不碰生产。

### Q-1
对应: I-1
前提: 预览环境 Brain 已启动；运行 `curl -sS $B/api/brain/runs/stats -o /dev/null -w '%{http_code}'`，确认预览库里没有 run_id 为 `stats`/`stages`/`output`/`publish-status` 的记录（拿到 404 即可；CI 空库天然满足）
操作: 依次 `curl -sS -w '\n%{http_code}' "$B/api/brain/runs/stats"`、`.../runs/stages`、`.../runs/output`、`.../runs/publish-status`
期望: 四条都是 HTTP 404；body 是 JSON，`.error` 分别等于 `run not found: stats`、`run not found: stages`、`run not found: output`、`run not found: publish-status`（这句文案只有 runs 读路由会给，能证明不是内容流水线处理的）；body 不含 `invalid input syntax`、`pipeline_id`、`platforms`、`stages` 字段

### Q-2
对应: I-1
前提: 预览环境 Brain 已启动；预览环境配了 `CECELIA_INTERNAL_TOKEN`（没配就跳过本场景，在报告里注明「未配 token，鉴权分支不可测」）
操作: 不带 token 请求 `curl -sS -w '\n%{http_code}' "$B/api/brain/runs/stats"`
期望: HTTP 401，`.error.code == "UNAUTHORIZED"`。说明请求落到了 runs 读路由的鉴权中间件，没有被内容流水线不鉴权地接走；不是 500

### Q-3
对应: I-2
前提: 预览环境 Brain 已启动
操作: 依次请求 `GET $B/api/brain/pipelines/not-a-uuid/stats`、`/api/brain/pipelines/not-a-uuid/stages`、`/api/brain/pipelines/not-a-uuid/output`、`/api/brain/pipelines/not-a-uuid/publish-status`；再试两个对抗输入：`GET $B/api/brain/pipelines/1%27%20OR%20%271%27%3D%271/stats`，以及 300 个字符 `a` 拼成的 id 请求 `/stats`
期望: 每一条都是 HTTP 400，body `{"error":"invalid pipeline id: must be a UUID"}`；所有 body 都不含 `invalid input syntax`、`syntax`、`uuid:` 这类 PostgreSQL 原始错误文本；没有一条返回 500

### Q-4
对应: I-3
前提: 场景自己造数据：先 `GET $B/api/brain/content-types` 拿到类型数组；数组为空时先 `POST $B/api/brain/content-types/seed` 再取一次。取第一个类型记为 `$T`
操作: `POST $B/api/brain/pipelines`，`content-type: application/json`，body `{"keyword":"qa-canary6-<时间戳>","content_type":"$T"}`，从返回的 201 body 里取 `.id` 记为 `$P`；然后依次 `GET $B/api/brain/pipelines/$P/stats`、`/stages`、`/output`、`/publish-status`
期望: 创建返回 201，`.id` 是 UUID；四个 GET 都是 HTTP 200，`.pipeline_id == $P`；`/stats` 的 `.stats` 是数组（新建的流水线是空数组），`/stages` 的 `.stages` 是对象，`/output` 有 `.output.keyword == "qa-canary6-<时间戳>"`，`/publish-status` 的 `.platforms` 是数组。`$P` 留给 Q-5 复用，清理在 Q-5 末尾做；不跑 Q-5 时，Q-4 结束后立刻执行 Q-5 末尾同样的清理两步

### Q-5
对应: I-3
前提: 预览环境 Brain 已启动；用 `node -e "console.log(require('crypto').randomUUID())"` 生成一个随机 UUID `$U`（库里肯定没有）
操作: `GET $B/api/brain/pipelines/$U/output`；再把 Q-4 里的 `$P` 转成全大写，请求 `GET $B/api/brain/pipelines/<大写的$P>/stats`；最后清理 Q-4 造的任务：`DELETE $B/api/brain/tasks/$P`，再 `GET $B/api/brain/tasks/$P`
期望: `$U/output` 照旧返回 404 `{"error":"Pipeline 不存在"}`（原有行为）；大写 UUID 的 `/stats` 返回 200（大写也认作合法 UUID）；`DELETE` 返回 200 且 `.status == "cancelled"`，随后的 `GET` 也是 `.status == "cancelled"`（`task-tasks.js:526` 软删除，任务进终态，不会再被当待办派出）

### Q-6
对应: I-4
前提: 预览环境 Brain 已启动；类型 `$T` 的取法同 Q-4
操作: `GET $B/api/brain/content-types`；`GET $B/api/brain/content-types/$T/config`；`GET $B/api/brain/pipelines/daily-stats`；`GET $B/api/brain/pipelines?limit=5`
期望: 四条都是 HTTP 200；`/content-types` 返回非空 JSON 数组且包含 `$T`；`/content-types/$T/config` 返回 JSON 对象；`daily-stats` 和列表接口返回 JSON，都不是 400 或 404

### Q-7
对应: I-5
前提: 场景自己造数据：生成 `RID="coding-workflow:$(node -e "process.stdout.write(require('crypto').randomUUID())")"`，`ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RID")`
操作: 按真实调用方 shape 发 `POST $B/api/brain/spans`，header `content-type: application/json`、`x-session-id: coding-workflow-runner`，body 是两条 span：`[{"run_id":"$RID","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/a","started_at":"2026-10-11T10:00:00.000Z","ended_at":"2026-10-11T10:00:05.000Z","executor_kind":"agent","outcome":"pass"},{"run_id":"$RID","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/b","started_at":"2026-10-11T10:00:10.000Z","ended_at":"2026-10-11T10:00:20.000Z","executor_kind":"agent","outcome":"pass"}]`；然后 `GET $B/api/brain/runs/$ENC`、`GET $B/api/brain/runs/$ENC?include=spans`；最后用另一个随机 UUID 拼的 `coding-workflow:<uuid>` 请求 `GET $B/api/brain/runs/<编码后>`
期望: POST 返回 200，`.inserted == 2`；第一个 GET 返回 200，`.run_id == $RID`，并且没有 `spans` 字段；`include=spans` 返回 200，`[.spans[].occurrence_key] == ["qa/a","qa/b"]`；不存在的 run 返回 404，`.error` 包含 `not found`

### Q-8
对应: I-1, I-2
前提: 预览环境 Brain 已启动
操作: 用 `xargs -P 10` 并发 20 次请求 `GET $B/api/brain/runs/stats`，同时并发 20 次请求 `GET $B/api/brain/pipelines/not-a-uuid/stats`
期望: 第一组 20 次全是 404 `run not found: stats`，第二组 20 次全是 400；没有一次返回 500；跑完后 Brain 进程还活着，`GET $B/api/brain/health` 返回 200

## 铁律对照

- INV-45cd3ec2：S-3 覆盖。本次不新增手写 smoke；runner 生成的 cw-*-qa-smoke.sh 沿用仓库约定：写入守卫未授权（SMOKE_ALLOW_WRITE≠1）时 exit 0 且不发请求。Q-4/Q-7 是写入场景，只在授权的预览/CI 环境里跑
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，按 INV-45cd3ec2 执行
- INV-dc18d43d：S-1 覆盖。非 UUID 的判定落在代码里做确定性拦截（400 / 放行给后续路由），不靠调用方自觉
- INV-ae4b4428：S-1 覆盖。guard 是 handler 内联的真实判断加阻断（return 400 / next('router')），不是事后探针
- INV-50954d28：S-2、Q-2 覆盖。runs 读路由原有的 `internalAuthOrLoopback` 鉴权不动；`/runs/*` 修复后反而第一次真正经过鉴权（以前被不鉴权的内容流水线接走）。内容流水线 4 个 GET 原本没有鉴权，这是存量问题，本次不扩大范围，已登记在「未覆盖真实链路」
- INV-564802ee：S-1 覆盖。400 body 是固定文案，不回显 PG 错误和入参，不碰凭据
- INV-459b6ff9：S-1 覆盖。guard 不打日志，不会把入参写进日志
- INV-c906dd6c：S-1、S-3 覆盖。验证命令只跑 `packages/brain/src/__tests__/` 下（vitest include 范围内）的测试文件，不跑 sprints/** 路径
- INV-3efefc23：不适用：这是 fix 类改动，不新增 brain/src 能力，也不新增 smoke 脚本，不涉及 smoke-allowlist 登记
- INV-96054a8b / INV-95477a66：不适用：只改 Brain 路由代码，开发和 QA 都在 MMV 本机或预览环境进行，不在 us-vps 上执行任何任务
- INV-0dc6b84f / INV-ca6bf8e7：不适用：本步骤是 MMV 上的 coding workflow 会话，不涉及引擎和机器的调度
- INV-52f1801e：不适用：不新增依赖，不需要装依赖；如果必须安装，只在仓库根执行 `npm ci --legacy-peer-deps --ignore-scripts`
- INV-f437b0fd：不适用：不新增 smoke 脚本；QA 场景里写入和读取用的是同一个 `<预览环境>` 地址
- INV-68976b17：不适用：内容流水线和 runs 表都没有租户维度，本次不改任何查询条件

## 未覆盖真实链路

- 内容流水线另外 4 条 `/:id` 写路由（`POST /:id/run`、`PATCH /:id`、`POST /:id/approve`、`POST /:id/pre-publish-check`）遇到非 UUID id 仍会把 PG 错误以 500 回显；别名挂载下 `PATCH /api/brain/<单段>` 也仍会被内容流水线接走。这些不在 I-n 范围内，本次不改，建议另立任务
- 内容流水线挂在 `/api/brain` 下的整套别名（含 `GET/POST /api/brain` 根路径会列出或创建流水线）是存量设计问题，本次不收窄，建议另立任务
- 内容流水线 4 个 GET 子路由没有鉴权，合法 UUID 遇到其他 DB 异常时仍以 500 回显 `err.message`，都是存量问题，建议另立任务
- 生产前端调用方（`apps/api/features/content/pages/ContentFactory.tsx`、`PipelineOutputPage.tsx`）走的是 `/api/brain/pipelines/<uuid>/...`，QA 只在接口层验证 200，没有打开前端页面点击验证
- `/output` 读的是宿主机 `~/perfect21/zenithjoy/content-output` 和 `~/claude-output/images` 目录，预览环境里没有真实产出文件，QA 只能验到 200 和 keyword 回显，验不到文章/图片内容
- Q-4 建的 `content-pipeline` 任务在 Q-5 清理前有几秒 `queued` 窗口，期间外部 worker 可能认领；清理后是 `cancelled` 行，仍留在 tasks 表里，按 `task_type='content-pipeline'` 不区分状态的计数（日报、选题缺口）可能多算一条。Q-6 只断言 200，不受影响

## 判定点

无：本改动只是确定性的路由匹配和 UUID 格式判定，不推断外部真实状态

## commander 裁决（第 1 次）

- T-2 / Q-2（qa_cannot_verify）：维持规格。Q-2 原文已写明「预览环境没配 `CECELIA_INTERNAL_TOKEN` 就跳过，注明鉴权分支不可测」，QA 按此执行，不算产品失败；本 PR 也没有改 `internal-auth.js` 和 runs 读路由的鉴权。QA 同一请求已经确认：落到了 runs 读路由（返回 `run not found: stats`），没有返回 500。
- 补充 S-4：Q-2 的 401 鉴权分支由单元测试确定性兜底，不依赖预览环境有没有配 token。`packages/brain/src/__tests__/content-pipeline-runs-shadow.test.js` 新增一组用例：测试内设 `CECELIA_INTERNAL_TOKEN`，按 server.js 的挂载顺序拼 app，不带 token 请求 `GET /api/brain/runs/{stats|stages|output|publish-status}`，四条都必须是 401、`.error.code == "UNAUTHORIZED"`，且 `pool.query` 一次都没调用；带正确 `x-internal-token` 请求 `/runs/stats`，必须是 404 `run not found: stats`，内容流水线的 SQL 一次都没调用。修复前这几条会被不鉴权的内容流水线接走、返回 500，所以这组用例能抓到回退。
- 补充 Q-2 判定：预览环境未配 token 时，T-2 记 CANNOT_VERIFY（环境原因），不阻塞合并；只要 S-4 用例在 CI 中通过，就视为 Q-2 的意图已满足。
