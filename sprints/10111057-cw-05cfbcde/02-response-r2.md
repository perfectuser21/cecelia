## 换思路
处理: 采纳（方向以 R-4 的「说明」为准）
说明: 本轮评审里没有单独的 `## 换思路` 小节，QA 在 R-4 里给的就是换方向：分数卡在「可验证」，原因是我只修补了 QA 约定的措辞，本机兜底命令本身却起不来。这一轮不再改场景措辞，改成让环境「能起来，并且能自己证明已经起来」：① 先用仓库现成的 `packages/brain/scripts/setup-test-db.sh` 建库并跑迁移；② 启动命令显式传 `DB_NAME/DB_HOST/DB_USER/DB_PASSWORD`，写法与预览脚本相同；③ 加一道就绪门 `curl / → "status":"running"`；④ 就绪门不过时，在报告里贴日志并按环境阻塞上报。Q-1～Q-7 的断言内容没动。

### R-4
处理: 采纳
说明:
- 根因核实属实：`packages/brain/src/db-config.js:19` 的库名只看 `DB_NAME`，没设就回落成 `cecelia`；第 32-38 行在 `NODE_ENV=development` 且库名为 `cecelia` 时直接 throw；第 45 行 `DB_PASSWORD` 默认是空串。原约定只传了 `DATABASE_URL`，所以启动必定失败。
- 改了 QA 约定里的本机兜底分支，拆成三步：
  1. `bash packages/brain/scripts/setup-test-db.sh`：幂等创建 `cecelia_test` 并跑全套迁移，保证迁移 531/542/546 的触发器和 activity 都在。
  2. 启动命令显式带 `DB_NAME=cecelia_test DB_HOST=localhost DB_USER=cecelia DB_PASSWORD="${DB_PASSWORD:-cecelia}"`，`DATABASE_URL` 指向同一个库，与 `preview-env-start.sh:325-330` 写法一致。日志写到 `/tmp/qa-brain-5299.log`。
  3. 就绪门：60 秒内 `curl -s http://127.0.0.1:5299/` 的返回含 `"status":"running"`。这个返回值来自 `server.js:564-566`。
- 新增一条：就绪门不过时，报告贴 `tail -n 20` 日志，按环境阻塞上报，不能算成接口失败，也不能跳过后判通过。
- Q-7 前提：5298（main）和 5299 用同一组 `DB_*`/`DATABASE_URL`、同一个 token，各自过一次就绪门；任一端不过，按同一规则上报。
- 实跑说明：这次 spec_revise 会话没有 shell 执行能力，**没能在本机实跑这条命令**。为了不靠猜，就绪门已写进约定，作为每次执行的第一道硬检查：命令起不来时，QA 拿到的是明确的环境阻塞和日志，不会再出现「没有目标可打却被误判」的情况。命令的每个变量都对照过 `db-config.js` 和预览脚本的源码。
