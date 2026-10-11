---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 3 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 8
可执行: 8

## 换思路
前两轮分数没涨，原因是对抗卡在一件规格文本解决不了的事上：本机兜底命令到底能不能起来。这只能靠实跑来证明，再改措辞没有用。开发方这轮已经从「改措辞」转成「让环境自己证明能起来」：先建库，再显式传 `DB_*`，加就绪门，起不来就按环境阻塞上报。这个方向是对的。我对照源码逐项核过，命令现在没有已知的启动阻断点：
- `setup-test-db.sh` 会建 `cecelia_test`，并用 `DB_NAME=cecelia_test` 跑全套迁移；
- `db-config.js:19` 读 `DB_NAME=cecelia_test`，所以 `:33` 的 dev 守卫不会触发；
- `runtime-safety.js:6` 遇到 `NODE_ENV=development` 判定为隔离运行时，`server.js:618-701` 的执行目录、自检、durable、Kernel 收敛、`5223` 公网 listener 都会跳过，5298/5299 两个实例不会抢同一个附属端口；
- `runtime-safety.js:24` 遇到 `SKIP_MIGRATIONS=false` 照样跑迁移，跟预览脚本同形；
- `server.js:564-566` 的根路由返回 `"status":"running"`，可以当就绪门；
- 迁移 546 的 rollup 规则（`546_runs_terminal_span.sql:22-26`）跟 Q-4 的 pass→fail→终态 pass 期望一致。

所以接下来不要在规格层面继续补措辞，换成：
1. **规格定稿**。剩下唯一没被证明的「命令是否真能跑通」，挪到实现阶段的第一步去证明：开发方实现前先在本机原样执行 QA 约定的三步（建库 → 启动 → 就绪门），把 `curl -s http://127.0.0.1:5299/` 的真实输出和 `exit=$?` 贴进 PR 描述（满足 INV-f200769d / INV-c906dd6c）。实跑不通，就回规格改命令，不要带着没验证的命令进 QA。
2. **smoke 和 QA 约定共用同一套启动方式**：`runs-read-smoke.sh` 只认 `BRAIN_URL`。PR 描述里写明本地跑 smoke 用的就是上面这个 5299 实例。这样「命令能起来」由 smoke 的实跑顺带证明，不必再单独争论。

## 上轮问题
- R-4: 关闭 —— QA 约定的本机兜底已改成三步：①用 `setup-test-db.sh` 建库并跑迁移；②启动时显式传 `DB_NAME/DB_HOST/DB_USER/DB_PASSWORD`，`DATABASE_URL` 指向同一个库（与 `preview-env-start.sh:324-341` 同形）；③60 秒就绪门。起不来时贴 `tail -n 20` 日志、按环境阻塞上报，不允许当成接口失败。Q-7 两端用的是同一组变量和同一道门。我对照 `db-config.js:19-45`、`runtime-safety.js:5-26`、`server.js:591-717` 逐项核过，没发现启动阻断点。开发方说明没能实跑，这一项按「换思路」第 1 条挪到实现阶段先实跑留证，不再阻断规格。
