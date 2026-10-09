---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 9
可验证: 6
场景覆盖: 8
回归风险: 6
可执行: 7

### R-1
针对: S-1, S-2, S-5
严重度: 重要
场景: 开发方按 S-1/S-2 加上 UUID 校验后跑 S-5 的全量回归，已有的 5 个 GET 用例全部从 200/404 变成 400，CI 变红。S-5 写的是"全部通过、没有破坏既有用例"，但规格没交代这些用例怎么处理。
依据: `packages/brain/src/routes/__tests__/task-projects.test.js:107-132` 用 `GET /projects/non-existent`（期望 404）、`GET /projects/p1`（期望 200，并断言 `countParams` 为 `['p1']`）；`packages/brain/src/__tests__/routes/task-goals.test.js:114-156` 用 `GET /goals/non-existent`（期望 404，查询 2 次）、`/goals/g1`、`/goals/kr1`（期望 200）。这些 id 都不是 UUID，新校验会在查库前直接返回 400。
说明: 在 S-1/S-2 里写明，要把这 5 个用例的 id 换成合法 UUID（只能用十六进制字符，如 `00000000-0000-4000-8000-000000000001`），对应的 mock 返回行 id 和 `countParams`/`res.body.id` 断言也要一起改。原有断言的语义（404 文案、查询次数、先查 objectives 再查 key_results）要保留，不能删用例。

### R-2
针对: Q-1, Q-2, Q-3, Q-4, Q-5, Q-6, Q-7, Q-8, Q-9
严重度: 重要
场景: QA 照公共前提的原文执行 `cd packages/brain && PORT=5299 node server.js`。因为没设 `DB_NAME`，Brain 会去连本机的 `cecelia` 库。本机（mmv）只有 cecelia_test/staging/scratch，所以要么启动失败、全部请求不通，要么连到错的库；而且 tick loop 会照常启动，开始派发测试库里的任务。结果 Q-1~Q-9 都没法在规格要求的"测试库"上跑。
依据: `packages/brain/src/db-config.js:19` 写的是 `dbName = process.env.DB_NAME || (isTest ? 'cecelia_test' : 'cecelia')`，`node server.js` 不是 test 环境，所以默认库名是 `cecelia`；`packages/brain/server.js:914` 启动时调 `initTickLoop()`，只有 `CECELIA_TICK_HARD_OFF=1` 才会提前返回（`src/tick-recovery.js:196`）。
说明: 公共前提要给出能直接照抄的完整命令，例如 `cd packages/brain && DB_NAME=cecelia_test CECELIA_TICK_HARD_OFF=1 PORT=5299 node server.js`，再加一个就绪检查（如 `curl -s -m 2 $B/health` 返回 200）后才开始跑 Q-n。同时写明测试库怎么准备（`bash packages/brain/scripts/setup-test-db.sh` 或跑 migrate）。

### R-3
针对: Q-1, I-1
严重度: 重要
场景: QA 按 Q-1 的期望去检查"响应体不含 `uuid`"，用 `grep -i uuid /tmp/q1.json` 会命中，因为规格规定的正确响应 `{"error":"Invalid project id: must be a UUID"}` 本身就带 `UUID`。QA 就会把正确的实现判成不通过。Q-1 的期望自相矛盾。
依据: spec Q-1 的期望同时要求响应体等于 `{"error":"Invalid project id: must be a UUID"}`，又要求"不含 `invalid input syntax`、`uuid`、`syntax` 之类"。S-1 第 2 步规定的文案也含 `UUID`。
说明: 把 Q-1 的禁用词换成只属于数据库原文的串，比如 `invalid input syntax`、`for type uuid`、`22P02`。Q-2、Q-3 也照这个口径写，让三条场景的判定标准一致。

### R-4
针对: S-2, S-4
严重度: 建议
场景: 开发方按 S-2/S-4 要断言"`mockPool.query` / `pool.query` 没被调用"，但 `src/routes/__tests__/task-goals.test.js` 和 `src/routes/__tests__/dev-records.test.js` 现在都只做结构检查或读源码，没有 mock `db.js`。直接用 supertest 打路由会连到真库。
依据: `src/routes/__tests__/task-goals.test.js:1-35` 里写的是"无 DB、无 mock"；`src/routes/__tests__/dev-records.test.js` 只用 `readFileSync` 读源码。
说明: 规格写明在这两个文件里加 `vi.mock('../../db.js', ...)` 和 express+supertest 的搭法，或者把新用例放进已有 mockPool 的 `src/__tests__/routes/task-goals.test.js`。
