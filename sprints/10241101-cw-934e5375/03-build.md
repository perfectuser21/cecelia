---
task_id: 934e5375-aac6-405e-8fad-57ecc9a8349d
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 运行回执判读手册构建记录

### B-1
对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。验证方式：先用内联 Node 断言检查 README 关键词，真实退出码 1，输出 `S-1 RED` 并列出缺少的新节、`--log-dir`、mtime 和默认目录；写文档后，用自建临时目录调用真实 CLI 并断言空、缺失、`chmod 000` 无权读取目录均返回 `[]`，文本提示“没有运行记录”，恢复权限后可读回执，两个回执按 mtime 倒序。实际命令：`node --input-type=module <<'NODE' ... NODE`（两次内联断言）、`git show 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd:packages/brain/scripts/coding-workflow/runner/README.md`（由内联断言调用）。输出摘要：`S1 PASS 6 项`，CLI 断言输出 `权限场景: chmod 000 后当前账号只得到空结果` 和 `PASS: 空/缺失/无权限目录、mtime 倒序、五种状态、PR 缺失、ci_fix 与过滤、文本显示`。仅在系统临时目录造数，未新增或提交仓库测试，符合文档限定范围。提交 SHA：`d2f5441c6aa0aeca00a0b879cffa90fcad60ceef`。

### B-2
对应 S-2。改动文件：同一 README。验证方式：改前内联内容断言输出 `S-2 RED`，缺 `pr_url_missing`、`pr-sync-pending.json`、`ci_fix`、`unreadable`；改后在自建临时目录写 running、completed、partial、failed、坏 JSON、qa/commander、回写待办和两次 ci_fix 尝试，调用真实 `status.mjs` 的 JSON 和文本模式作可失败断言。实际命令：`node --input-type=module <<'NODE' ... NODE`（README 红绿断言及 `spawnSync(node, [status.mjs, '--log-dir', 临时目录, '--json'])`/文本模式）。输出摘要：`S2 PASS 10 项`；CLI 输出上述 `PASS: 空/缺失/无权限目录、mtime 倒序、五种状态、PR 缺失、ci_fix 与过滤、文本显示`，其中断言确认待办显示 unreadable、cifix 文件不成为状态行、`ci_fix.attempts=2` 且 `last_result=pass`。未改仓库测试、程序或现场状态。提交 SHA：`d2f5441c6aa0aeca00a0b879cffa90fcad60ceef`。

### B-3
对应 S-3。改动文件：同一 README。验证方式：改前内联断言输出 `S-3 RED`，缺 Brain 终态查询字段；改后自造无 PR URL 的 completed 回执，断言 JSON 保留 completed、`pr_url=null`、`reason_code=pr_url_missing`，文本 completed 行不显示原因；再断言 README 包含 GitHub 最终 head/merged、实际所属 Brain 的只读任务接口、`runner.phase=merged`、`merge.merged=true`、`qa_state` 与不手工改批准或 FAIL 的说明。实际命令：`node --input-type=module <<'NODE' ... NODE`（CLI 及 README 断言）。输出摘要：`S3 PASS 8 项`，CLI 综合断言 PASS。没有查询生产、GitHub 或预览，也没有修改任何批准或运行状态；最终合并及 Brain 终态留给后续阶段实际核验。提交 SHA：`d2f5441c6aa0aeca00a0b879cffa90fcad60ceef`。

### B-4
对应 S-4。改动文件：同一 README。验证方式：改前新节存在性断言输出 `S-4 RED`；改后按基线 README 的 26 个原文块逐字节、按顺序匹配，检查新节在原健康段和故障段之间。实际命令：`node --input-type=module <<'NODE' ... NODE`、`git rev-list --parents --topo-order 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd..HEAD`、`git diff --raw --no-renames 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd HEAD`、`git diff --name-status 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`、`git diff 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd HEAD -- .implementation-source-relations.json`、`git diff --check`。输出摘要：`S4 PASS 3 项`、`PASS 基线 README 26 个原文块按字节和顺序保留`；提交后 DAG 只有本次单父提交，raw diff 仅 README 且 mode `100644→100644`，manifest、暂存区和工作区差异均空；全仓未跟踪只列本 sprint 的现有流水线 Markdown。暂存及提交前逐项核对实际 diff，只 add README；未编辑、暂存或提交 manifest 和 sprint 文件。提交 SHA：`d2f5441c6aa0aeca00a0b879cffa90fcad60ceef`。

### B-5
对应 S-5。改动文件：同一 README；本步骤不执行后续 QA/evaluate 或控制器 main 同步。验证方式：改前新节存在性断言输出 `S-5 RED`，改后 `S5 PASS 1 项`；提交后以固定 initial base 完整枚举提交 DAG、唯一提交的父子 raw diff、全量路径、暂存区、工作区与全仓未跟踪，并核对 manifest 未改。实际命令：同 B-4 的 `git rev-list`、`git diff --raw --no-renames`、四项 `git diff`/`git ls-files --others --exclude-standard`，另执行 `git show --stat --format=fuller HEAD`。输出摘要：HEAD `d2f5441c6aa0aeca00a0b879cffa90fcad60ceef`，唯一提交 `1 file changed, 17 insertions(+)`，只有 README 产品变更；无 main 同步或来源增量，本 sprint 记录均未提交。范围验证使用内联命令和临时造数，没有新增仓库测试；本轮 03/04 隐藏与恢复、来源投影、原生全账、QA、裁判和正式 CI 属后续控制器事实，本记录不预判其结果。提交 SHA：`d2f5441c6aa0aeca00a0b879cffa90fcad60ceef`。
