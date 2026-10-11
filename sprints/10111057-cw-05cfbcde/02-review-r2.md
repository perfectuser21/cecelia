---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 6
场景覆盖: 8
回归风险: 8
可执行: 7

## 上轮问题
- R-1: 关闭 —— S-1 已改为路由器顶部挂 `internalAuthOrLoopback`，跟 spans 写入侧用的是同一个中间件；Q-2 改成不带 token 和错 token 都 401、带 token 200，并且 401 的 body 里不含记录字段；铁律对照 INV-50954d28 写的是实际做法。另外核对过 `internal-auth.js:39-58`，401 的 body 形状是 `error.code=UNAUTHORIZED`，与 Q-2 的期望一致。
- R-2: 关闭 —— QA 约定开头加了预览环境 token 判定步骤（401/503 分流）和 `TOKEN` 的来源；Q-7 两端都改在本机起，环境变量逐项相同。思路成立。但本机兜底命令自身起不来，作为新问题记在 R-4。

### R-4
针对: Q-1, Q-2, Q-3, Q-4, Q-5, Q-6, Q-7, I-4, I-5
严重度: 重要
场景: 预览环境探测返回 503（`preview-env-start.sh:324-341` 没注入 token，这是最可能出现的情况），QA 按约定在本分支 worktree 执行 `env CECELIA_INTERNAL_TOKEN=qa-local-token NODE_ENV=development PORT=5299 DATABASE_URL=<cecelia_test> ... node server.js`，Brain 启动时直接抛错「禁止在 dev 环境连接 cecelia 生产 DB」退出。Q-1～Q-6 没有目标可打，Q-7 的 5299/5298 两端也都起不来，I-4、I-5 全部验不了。
依据: `packages/brain/src/db-config.js:19` 的库名只取 `process.env.DB_NAME`，缺省回落到 `'cecelia'`，`DATABASE_URL` 不参与（只有 `durable/dbos-runtime.js:40` 读它）。`db-config.js:32-38` 在 `NODE_ENV=development` 且库名为 `cecelia` 时直接 throw。worktree 里没有 `.env`（只有 `*.example`），dotenv 补不上 `DB_NAME`。另外 `DB_PASSWORD` 缺省是空串（`db-config.js:45`），本机 postgres 要密码时也连不上。预览脚本自己是显式传 `DB_NAME/DB_HOST/DB_USER/DB_PASSWORD` 的（`preview-env-start.sh:326-330`），约定命令却漏了。
说明: 本机兜底命令和 Q-7 两端的启动命令改成显式设置 `DB_NAME=<本机测试库名>`（另加 `DB_HOST`/`DB_USER`/`DB_PASSWORD`，跟 `DATABASE_URL` 指向同一个库，与预览脚本同形）。写进规格前在本机先实跑一次，确认 `curl -s http://127.0.0.1:5299/` 返回 `"status":"running"` 再定稿（同 INV-c906dd6c / INV-f200769d：验证命令写进合同前先实跑）。约定里再补一句：本机起不来时，报告里贴启动日志最后 20 行，按环境阻塞上报，不允许当成接口失败。
