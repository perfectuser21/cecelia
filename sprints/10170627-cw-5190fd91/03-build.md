---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

# 运行回执判读手册构建记录

### B-1
对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。验证方式：仓库外临时目录中的合成回执，真实调用只读 `status.mjs`，内联 Python 断言 README 与 CLI 输出；没有新增或修改仓库测试。先运行 `python3 - <<'PY' ... PY` 检查五条规格所需文案，退出码 1，S-1 报缺小节、`CODING_WF_LOG_DIR`、`mtime`。编辑后运行 `python3 - <<'PY' ... PY`，以 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <临时目录> [--json]` 验证空目录、缺失目录、两份不同 mtime 回执，退出码 0，输出 `S-1 PASS: 空目录/不存在目录的两种输出与退出码、mtime 倒序、README 用法断言通过`。提交 SHA：`178f61849d85be5a9370f23c033e48ae006cfe25`。

### B-2
对应 S-2。改动文件：同 B-1。验证方式：独立临时目录合成 running、partial、failed、completed、非回执与坏 JSON、`pr-sync-pending.json`、`cifix-37.json`，真实运行 CLI 的 JSON 和普通模式并内联断言；仅用临时材料，符合只改 README 的范围。红灯命令同 B-1，退出码 1，S-2 报缺 `pr-sync-pending.json`、`unreadable`、`last_result`。绿灯命令为 `python3 - <<'PY' ... PY`（内调用 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <临时目录> [--json]`），退出码 0，输出 `S-2 PASS: 五类状态、非回执/坏 JSON、待办保留和本地 ci_fix 摘要断言通过`；非 GitHub `/pull/37` 也得到本地修复摘要。提交 SHA：`178f61849d85be5a9370f23c033e48ae006cfe25`。

### B-3
对应 S-3。改动文件：同 B-1。验证方式：临时目录分别放置有、无 `outputs.pr_url` 的 completed 回执，真实调用 CLI 两种模式；内联断言 JSON 的 `pr_url_missing`、`pr_url=null` 与普通行不显示该原因，并核对 README 的只读终态判据，不访问生产或 GitHub。红灯命令同 B-1，退出码 1，S-3 报缺 `pr_url_missing`、`runner.phase=merged`、`merge.merged=true`。绿灯 `python3 - <<'PY' ... PY` 退出码 0，输出 `S-3 PASS: 缺 PR URL 的 JSON/普通行差异与最终合并诊断文字断言通过`。提交 SHA：`178f61849d85be5a9370f23c033e48ae006cfe25`。

### B-4
对应 S-4。改动文件：同 B-1；本条没有授权其它产品文件。红灯命令同 B-1，退出码 1，S-4 因缺新增小节失败。提交前实际运行 `git rev-parse HEAD`（输出固定基线 `04b88ddba4b1aa23a156d59734b4d88f621fe1e9`）、`git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD` 与 `git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD`（均无输出）、`git diff --cached --name-status`（无输出）、`git diff --name-status`（仅 README）、`git ls-files --others --exclude-standard`（九个本轮 sprint Markdown）。`git diff --check` 和 `git diff --cached --check` 均无输出、退出码 0。`git add -- packages/brain/scripts/coding-workflow/runner/README.md && git diff --cached --check && git diff --cached --name-status && git commit -m 'docs(coding-workflow): explain runner receipt status'` 退出码 0，暂存清单仅 README，提交显示 `1 file changed, 10 insertions(+)`。提交后内联 Python 逐父边调用 `git diff --no-ext-diff --no-renames --raw --full-index --binary <父SHA> <提交SHA> --`，并断言固定基线到 HEAD 仅 README、原 README 字节按顺序保留、manifest 零差异、暂存区与工作区空、全仓未跟踪仅九个本轮 sprint Markdown；最终退出码 0，输出父边 `04b88ddba -> 178f61849` 仅 README 一处修改及以上 PASS。该内联校验先后两次因校验脚本误把 `--raw --binary` 输出当成仅一行、又误数补丁行内 `@@` 而退出码 1；修正为分别统计 raw 行与补丁标题后重跑通过。验证只读 Git 和 README，不改受保护 manifest 或其它仓库文件。提交 SHA：`178f61849d85be5a9370f23c033e48ae006cfe25`。

### B-5
对应 S-5。改动文件：同 B-1；本条没有代码或报告编辑授权。红灯命令同 B-1，退出码 1，因 README 新小节尚不存在而失败。提交前运行 `python3 - <<'PY' ... PY` 断言 `03-build.md` 尚未写入，退出码 0，输出 `S-5 当前阶段 PASS: build 文件尚未写入；本轮 QA 隐藏与恢复事实须由后续控制器、裁判核验`。提交后范围内联校验退出码 0，输出 `S-5 build 待写；QA 隐藏/恢复尚未发生，留给控制器与裁判核验`。本条当前只核本阶段可见范围；QA 会话隐藏事实、会话后按字节及模式完整恢复、受保护凭证与逐条原生输出均尚未发生，须由本轮可信控制器和独立裁判按规格核验，不能由 build 自述判通过。此文件是最后写入的本轮流水线总结，不纳入上述提交。提交 SHA：`178f61849d85be5a9370f23c033e48ae006cfe25`。
