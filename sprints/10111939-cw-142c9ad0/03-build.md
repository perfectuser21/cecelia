---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: build
upstream: ["02-spec.md#S-1","02-spec.md#S-2","02-spec.md#S-3"]
---
# Build 总结

### B-1
- 对应：S-1
- 改动文件：`packages/brain/src/routes/content-pipeline.js`——新增模块内 `UUID_RE` 与 `guardPipelineId(req, res, next)`（不导出，上方一行注释说明别名挂载为何放行）；只在 `GET /:id/stages`、`/:id/output`、`/:id/publish-status`、`/:id/stats` 四个 handler 的第一行调用。别名挂载 `/api/brain` 下非 UUID → `next('router')`；`/pipelines` 下非 UUID → 400 `{"error":"invalid pipeline id: must be a UUID"}`。其余 `/:id` 写路由没改。
- 新增测试：`packages/brain/src/__tests__/content-pipeline-runs-shadow.test.js`（16 条，vitest + supertest，挂载顺序与 server.js 一致：pipelines → 别名 → runs 读路由）。
- TDD 红：先单独提交测试，`npx vitest run src/__tests__/content-pipeline-runs-shadow.test.js` → `Tests 9 failed | 7 passed (16)`（`/runs/stats|stages|publish-status` 得到 200 内容流水线响应，`/runs/output` 得到 `Pipeline 不存在`，`/pipelines/not-a-uuid/*` 得到 500）。
- TDD 绿：实现后同一命令 → `Test Files 1 passed (1) / Tests 16 passed (16)`。
- 提交：测试 `40b15d8fd`，实现 `ee8ab5283`

### B-2
- 对应：S-2
- 改动文件：无（`runs-read.js`、`server.js` 没改）。
- 新增测试（在 B-1 的测试文件里）：`GET /api/brain/runs/coding-workflow%3A<uuid>` → 200 返回行，SQL 为 `SELECT * FROM runs WHERE run_id = $1`；`?include=spans` 走 `pool.connect` 事务分支，`spans` 按顺序为 `["qa/a","qa/b"]`，client 释放 1 次。
- 运行：`npx vitest run ... src/__tests__/runs-read-smoke-guard.test.js ...` 通过（见 B-3 的汇总命令）。
- 提交：`40b15d8fd`

### B-3
- 对应：S-3
- 改动文件：`packages/brain/src/__tests__/content-pipeline-routes.test.js`（3 处 `pipe-1/stages` 改成固定 UUID `PIPE_UUID`）；`packages/brain/src/__tests__/content-pipeline-publish-status.test.js`（7 个 `pipe-*` id 改成合法 UUID，`pipeline_id` 期望值同步改；`req` 补 `baseUrl: '/api/brain/pipelines'`，handler 调用多传一个 `vi.fn()` 作为 `next`）。业务断言都没改。
- 新增测试（在 B-1 的测试文件里）：`/pipelines/<uuid>/stats` → 200 且 `pipeline_id` 回显；大写 UUID → 200；别名 `/api/brain/<uuid>/stages` → 200；`/api/brain/content-types` → 200；`/api/brain/content-types/<type>/config` → 200（不被 guard 拦截）。
- 运行：`cd packages/brain && npx vitest run src/__tests__/content-pipeline-routes.test.js src/__tests__/content-pipeline-publish-status.test.js src/__tests__/content-pipeline-trigger-topics.test.js src/__tests__/content-pipeline-runs-shadow.test.js src/__tests__/runs-read-smoke-guard.test.js` → `Test Files 5 passed (5) / Tests 68 passed (68)`，退出码 0。另外加跑 `src/routes/__tests__/content-pipeline.test.js` 和 `content-pipeline-test-step.test.js`：7 个文件 75 条全部通过。
- 只改实现不改这两个测试时，它们共有 10 条失败（非 UUID id 被 guard 拦成 400）；改完 id 后转绿。
- DevGate：`node scripts/facts-check.mjs` → `All facts consistent.`（exit 0）；`bash scripts/check-version-sync.sh` → `All version files in sync`（exit 0）；`node packages/quality/scripts/devgate/check-dod-mapping.cjs` → `映射检查通过 (309 项)`（exit 0）。
- 提交：`ee8ab5283`

### B-4
- 对应：S-1、S-2、S-3（为满足仓库 CI 规矩补的 smoke）
- 说明：需求标题以「金丝雀6」开头，不是「修复」，会按 feat 合入；又改了 `packages/brain/src` 的非测试文件，按 CI 规矩必须带 smoke。规格的铁律对照（INV-3efefc23）写的是「不新增 smoke」，这里以 CI 门禁为准补了一个。脚本只读、不写库，所以没接写入守卫。
- 改动文件：新增 `packages/brain/scripts/smoke/content-pipeline-runs-shadow-smoke.sh`（四个后缀逐条断言：`/runs/<段>` 返回 404 且 `.error == "run not found: <段>"`；`/pipelines/not-a-uuid/<段>` 返回 400 固定文案，不含 `invalid input syntax`；合法随机 UUID 的 `/stats` 返回 200）；在 `packages/quality/smoke-allowlist.txt` 登记。
- 实际运行：用本机 `cecelia_test` 库起了一个最小 express 实例（真实的 content-pipeline 路由 + runs 读路由，挂载顺序同 server.js，端口 5399），执行 `BRAIN_URL=http://127.0.0.1:5399 bash scripts/smoke/content-pipeline-runs-shadow-smoke.sh` → 10 行 PASS，最后一行 `PASS: content-pipeline-runs-shadow-smoke.sh`，exit 0。跑完已停掉实例。
- 提交：`a5a5f442a`
