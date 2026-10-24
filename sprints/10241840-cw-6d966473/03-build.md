---
task_id: 6d966473-8217-4881-9373-457abef4428f
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

# 运行回执判读手册 build

### B-1

对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。先以 `python3 - <<'PY' ... PY` 对最终文档所需标题、`--log-dir <dir>`、mtime 倒序做可失败断言，修改前退出 1，输出 `S-1: FAIL`（缺上述内容）。插入小节后再次运行内联 Python 断言，并由该命令在 `tempfile.TemporaryDirectory` 自造新旧回执、调用真实 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <临时目录> --json` 及文本模式；另对不存在目录执行两种模式。命令退出 0，输出 `S-1 文档断言 PASS`、`S-1 CLI PASS: JSON/文本按 mtime 倒序 ['new', 'old']`、`S-1 CLI PASS: 不存在目录返回 [] / 没有运行记录，退出 0`。隔离目录只存自造回执，不增改仓库测试，不读生产。提交 SHA：`510941c0231ff43428232b2891c37e4c83d28f1d`。

### B-2

对应 S-2。改动文件：同一 README。修改前同一 `python3 - <<'PY' ... PY` 内容断言退出 1，输出 `S-2: FAIL`，缺状态、待办名与 ci_fix 说明。修改后内联 Python 命令在临时目录写入进度、partial、failed、坏 JSON、qa、commander、`pr-sync-pending.json`、有两次尝试的 `cifix-42.json`，调用真实 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <临时目录> --json` 和文本模式并断言返回值。命令退出 0，输出 `S-2 文档断言 PASS`、`S-2 CLI PASS: running/partial/unreadable/ci_fix/null 与回执汇总一致`。验证只读 CLI 和临时自造文件，未修改仓库测试或运行状态。提交 SHA：`510941c0231ff43428232b2891c37e4c83d28f1d`。

### B-3

对应 S-3。改动文件：同一 README。修改前内容断言退出 1，输出 `S-3: FAIL`，缺 PR URL 原因及 Brain 终态说明。修改后首次内联断言因要求独立的反引号 `pr_url_missing` 而退出 1；README 实际写的是更精确的 `reason_code=pr_url_missing`，故修正断言而未改文案。重跑 `python3 - <<'PY' ... PY`，在临时目录构造有、无 `outputs.pr_url` 的 completed 回执并调用上述真实 CLI 两种模式；命令退出 0，输出 `S-3 文档断言 PASS`、`S-3 CLI PASS: 无 PR URL 仍 completed，JSON 有原因，文本省略原因`。未调用 GitHub、Brain 或生产，也未创建 PR。提交 SHA：`510941c0231ff43428232b2891c37e4c83d28f1d`。

### B-4

对应 S-4。产品改动文件：同一 README；没有改 manifest 或其它产品文件。修改前的文档内容断言退出 1，确认新增小节尚缺；修改后运行 `python3 - <<'PY' ... PY`，用 `git show a039701b0bbbc739623cc73823ad47bf5e584ee7:packages/brain/scripts/coding-workflow/runner/README.md` 逐行按原字节和顺序对照当前文件，命令退出 0，输出 `S-4 PASS: 基线 README 81 行按原字节和顺序保留；当前 106 行`。另实际运行 `git rev-list --parents a039701b0bbbc739623cc73823ad47bf5e584ee7..HEAD`、`git diff --name-status a039701b0bbbc739623cc73823ad47bf5e584ee7 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`、`git diff -- .implementation-source-relations.json`、`git diff --check`，并用内联 Python 对全仓路径作断言：提交前 HEAD、暂存区、manifest 均无差异，工作区只改 README；全仓未跟踪仅本任务 sprint 记录。提交前 `git diff --cached --check` 退出 0，暂存区只有 README，统计为 25 行新增。提交后固定基线到 HEAD 仅 README，暂存区和工作区均空；sprint 记录仍未跟踪，未混入提交。此验证只读 Git 事实与文档内容，没有新增仓库测试，也不冒充后续 publish/QA 的现场。提交 SHA：`510941c0231ff43428232b2891c37e4c83d28f1d`。

### B-5

对应 S-5。产品改动文件：无；S-5 规定后续 QA 与裁判的阶段证据，不授权 build 修改报告或保护凭证。修改前的内联文档断言曾输出 `S-5: FAIL`，但该断言把“完整恢复尚未发生”误当成 README 产品要求，未据此向手册加入内部流程。实际运行的范围检查 `python3 - <<'PY' ... PY` 退出 0，输出 `S-5 阶段边界: 当前 build 尚无 QA 会话后 03/04 恢复事实；留待控制器及独立裁判核实`；`git ls-files --others --exclude-standard` 也只列当前 sprint 已有记录。当前 build 无法验证未来的 03/04 临时隐藏、完整恢复、最终 05 原生全账或保护凭证，均不宣称通过。遵守仅 README 产品编辑及仅 BUILD_PATH 总结写入的边界，未新增或修改仓库测试。关联提交 SHA：`510941c0231ff43428232b2891c37e4c83d28f1d`（该提交只含 README）。
