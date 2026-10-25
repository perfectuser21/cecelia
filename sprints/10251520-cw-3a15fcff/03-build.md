---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

### B-1

对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，文末追加 FAQ 的命令、目录、mtime 与空结果说明。先运行 `node --input-type=module -e '…断言 README 含新 FAQ 标题…'`，实际退出 1，输出 `S-1 RED S-1: 缺少 ## 回执常见误读与核账示例`。追加后运行 `node /tmp/cw_a12_check.mjs`，实际退出 0，输出 `S-1 PASS: CLI、默认目录、mtime、空结果与示例标识`；再运行内联 `node --input-type=module -e '…spawnSync status.mjs 对不存在/空目录的 JSON 与文本作断言…'`，退出 0，输出不存在和空目录 JSON 均为 `[]`、文本为“没有运行记录（临时目录）”。临时目录位于系统临时区，已删除；未运行服务或生产 API。提交 SHA：`b5e6e650b78735a564dde9f5c13f14cb66bdd985`。

### B-2

对应 S-2。改动文件：同一 README，追加 `running`、`partial`/`failed`、缺 PR 的 `completed`、CI 修复与 `unreadable` 示例。先运行 `node --input-type=module -e '…断言非现场 JSON 样例标识…'`，实际退出 1，输出 `AssertionError [ERR_ASSERTION]: S-2: 缺少非现场 JSON 样例标识`。追加后 `node /tmp/cw_a12_check.mjs` 退出 0，输出 `S-2 PASS: 3 个 JSON 块解析、原因优先级、缺 PR 文本/JSON、CI 修复与非回执提示`；脚本仅在内存解析 README 示例，调用当前源码的 `summarizeReceipt`、`formatStatus` 作可失败断言。未新增仓库测试文件。提交 SHA：`b5e6e650b78735a564dde9f5c13f14cb66bdd985`。

### B-3

对应 S-3。改动文件：同一 README，追加 terminal 阶段、真实合并核账、deps 就绪分支及 dry-run 限度。先运行 `node --input-type=module -e '…断言 awaiting_manual_merge…'`，实际退出 1，输出 `S-3 RED S-3: 缺少 awaiting_manual_merge`。追加后 `node /tmp/cw_a12_check.mjs` 退出 0，输出 `S-3 PASS: terminal/deps/new-task 静态分支与核账提示`；脚本对照当前 `terminal.mjs`、`deps.mjs`、`new-task.mjs` 的实际分支。未执行 new-task、GitHub、Brain API 或真实建单。提交 SHA：`b5e6e650b78735a564dde9f5c13f14cb66bdd985`。

### B-4

对应 S-4。改动文件：同一 README；固定基线原文作为字节前缀，模式仍为 `100644`。新增 FAQ 尚不存在的初始断言退出 1，构成该追加要求的 RED。提交前后运行 `node /tmp/cw_a12_check.mjs` 均退出 0，其中 `S-4 PASS: 固定基线 README 字节前缀、模式及 manifest 零差异`。提交后运行 `git rev-list --parents 05f28a953a9fa184ed53619eba2127a203edab0e..HEAD`，只列本次提交及固定基线父提交；`git diff --raw --no-abbrev --no-renames 05f28a953a9fa184ed53619eba2127a203edab0e HEAD` 仅列 README 的 `100644` blob 变更。`git diff --name-status` 同样只列 README；`git diff --cached --name-status` 与 `git diff --name-status` 均无输出；`git diff --exit-code … -- .implementation-source-relations.json` 退出 0、无输出。`git ls-files --others --exclude-standard` 只列本任务 sprint 的既有记录。没有模型编辑 manifest、测试、程序或其它产品文件。提交 SHA：`b5e6e650b78735a564dde9f5c13f14cb66bdd985`。

### B-5

对应 S-5。产品改动文件仍只有 README；本条记录文件为 `sprints/10251520-cw-3a15fcff/03-build.md`，按阶段合同在提交后单独写入且不提交。写前运行 `node --input-type=module -e '…断言本轮 03-build.md 已存在…'`，实际退出 1，输出 `S-5 RED: 本轮 build 记录尚未生成`。此前 `node /tmp/cw_a12_check.mjs` 的当前阶段检查退出 0，输出 `S-5 PASS: 当前仅准备本轮 build 报告；未来 QA/恢复/CI 不预判`；这仅验证写入前现场，不宣称尚未发生的 QA 隐藏、会话后恢复、可信来源门、正式 CI、合并、Learning 或预览回收已通过。本报告仅记真实命令及摘要；本轮原生全账由可信控制器按原合同装配。未新增仓库测试或 smoke，符合纯文档授权范围。产品提交 SHA：`b5e6e650b78735a564dde9f5c13f14cb66bdd985`；本报告不提交。
