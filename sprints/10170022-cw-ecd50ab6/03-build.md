---
task_id: ecd50ab6-7553-4633-9bfe-2ae9448af68d
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1
对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。验证方式：临时目录内自建两份终态回执，调用真实 Node CLI 的文本与 JSON 格式，并检查 mtime 倒序、缺失目录空结果和 README 内容；验证脚本仅放在 `/tmp/cw-ecd50ab6-verify.py`，符合原任务禁止修改仓库测试的边界。

实际命令：`python3 /tmp/cw-ecd50ab6-verify.py S-1`。修改前退出 1，断言输出 `S-1 README 缺少 运行回执如何判读`；修改后退出 0，输出 `S-1 PASS: 双格式倒序、缺失目录空结果、README 说明`。提交 SHA：`ced3da22fa0f0c591642df26dce257bfa0291469`。

### B-2
对应 S-2。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。验证方式：临时目录内自建进度、三种终态、坏 JSON、合法非回执 JSON、`pr-sync-pending.json` 和 cifix 状态，调用真实 CLI 核对 JSON 字段、文本摘要及前后文件名；临时脚本不在仓库内，不新增测试文件。

实际命令：`python3 /tmp/cw-ecd50ab6-verify.py S-2`。修改前退出 1，断言输出 `S-2 README 缺少 running`；修改后退出 0，输出 `S-2 PASS: 全部状态、ci_fix、保留原文件、README 说明`。提交 SHA：`ced3da22fa0f0c591642df26dce257bfa0291469`。

### B-3
对应 S-3。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。验证方式：临时目录内自建缺 PR URL 的 completed 回执，真实 CLI 验证 JSON 中 `pr_url=null`、`reason_code=pr_url_missing`，文本保留 completed 却不显示该原因，并断言 README 列出只读核对字段；不访问生产、GitHub 或 Brain，不提交测试。

实际命令：`python3 /tmp/cw-ecd50ab6-verify.py S-3`。修改前退出 1，断言输出 `S-3 README 缺少 pr_url_missing`；修改后退出 0，输出 `S-3 PASS: 缺 PR 回执、文本隐藏原因、README 终态核对`。提交 SHA：`ced3da22fa0f0c591642df26dce257bfa0291469`。

### B-4
对应 S-4。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。验证方式：临时脚本按原字节及顺序核对固定基线 README 为最终 README 的有序子序列，检查新增小节与 manifest 零差异；另逐条枚举固定基线至 HEAD 的提交和逐父 raw diff、全量差异、暂存区、工作区及全仓未跟踪文件。只读核对范围，不改程序、manifest、仓库测试或其它 sprint 报告。

实际命令与输出摘要：`python3 /tmp/cw-ecd50ab6-verify.py S-4` 修改前退出 1，断言输出 `S-4 尚无获授权的新增小节`；修改后及提交后均退出 0，输出 `S-4 PASS: 基线 README 有序原文字节保留、manifest 零差异、新小节存在`。`git rev-list --parents --reverse a2b043435339c90b40d6fa0c0df369d15b18eb49..HEAD` 仅列出本提交及固定基线父 SHA；`git diff --no-renames --raw HEAD^ HEAD` 仅列出 README 的 100644 修改；`git diff --name-status a2b043435339c90b40d6fa0c0df369d15b18eb49 HEAD` 仅列出 README；`git diff --cached --name-status` 与 `git diff --name-status` 均无输出；`git ls-files --others --exclude-standard` 仅列出本任务 sprint 内已有七份未跟踪流水线报告；`git diff --exit-code a2b043435339c90b40d6fa0c0df369d15b18eb49 HEAD -- .implementation-source-relations.json` 退出 0、无输出。`git diff --check` 与 `git diff --cached --check` 均退出 0、无输出。提交 SHA：`ced3da22fa0f0c591642df26dce257bfa0291469`。
