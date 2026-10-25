---
task_id: 3d11e9d3-3660-4412-afba-722c7a1936c3
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

### B-1

- 对应：S-1。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md` 文末追加独立 clone、同名真实分支、marker 归属与清理判读。
- 验证方式：临时 `/private/tmp/cw-3d11e9d3-check.mjs` 只读对照 README 和当前 `pr-branch.mjs`、`pr-checkout.mjs`、`worktree.mjs`；不调用产品函数、不新增仓库测试。
- 实际命令与输出：追加前执行 `node /private/tmp/cw-3d11e9d3-check.mjs S-1`，因“缺少文末小节”退出 1；追加后首次因缺少 `origin fetch URL`、再次因缺少 `独立 refs/index` 各退出 1，修正文案后同命令输出 `S-1 PASS：源码、README、固定基线断言成立`，退出 0。
- 提交 SHA：`d1c172c1cdf8bca7851453739fb7b5deb526c641`。

### B-2

- 对应：S-2。
- 改动文件：同一 README 新节的 bad、rounds、QA 语义、裁判、阈值升级及非现场示例。
- 验证方式：临时只读 Node 断言检查 README、`qa-gate.mjs` 与 `config.mjs` 的真实源码，并在内存解析示例 JSON；没有改动测试文件或运行 QA。
- 实际命令与输出：追加前执行 `node /private/tmp/cw-3d11e9d3-check.mjs S-2`，因“缺少文末小节”退出 1；追加后输出 `S-2 PASS：源码、README、固定基线断言成立`，退出 0。
- 提交 SHA：`d1c172c1cdf8bca7851453739fb7b5deb526c641`。

### B-3

- 对应：S-3。
- 改动文件：同一 README 新节的 report 投递、任务账与产品判定分账、历史及现场保留说明。
- 验证方式：临时只读断言用 `git show` 读取固定基线 README，检查其完整字节是当前 README 前缀，`git ls-tree` 检查基线 mode 为 `100644`；同时对照源码与新节关键词。仅在允许的临时位置保存验证脚本。
- 实际命令与输出：追加前执行 `node /private/tmp/cw-3d11e9d3-check.mjs S-3`，因“缺少文末小节”退出 1；首次追加后因缺少明确的“不补写”退出 1，修正文案后输出 `S-3 PASS：源码、README、固定基线断言成立`，退出 0。
- 提交 SHA：`d1c172c1cdf8bca7851453739fb7b5deb526c641`。

### B-4

- 对应：S-4。
- 改动文件：同一 README 新节的固定 initial base、发布前后范围与完整 DAG 判读。
- 验证方式：临时只读文档断言，加原生 Git 全范围核对；全仓未跟踪项先完整枚举，再确认均为本任务原有 sprint 记录。未修改 manifest、程序、配置或仓库测试。
- 实际命令与输出：追加前执行 `node /private/tmp/cw-3d11e9d3-check.mjs S-4`，因“缺少文末小节”退出 1；追加后输出 `S-4 PASS：源码、README、固定基线断言成立`，退出 0。提交后执行 `git rev-list --parents --reverse 0bbee7b45e4ce79ed2752785fbdb0fd805357879..HEAD`，仅列本提交及固定基线父提交；`git diff --name-status 0bbee7b45e4ce79ed2752785fbdb0fd805357879 HEAD` 仅输出 README 的 `M`；`git diff --cached --name-status`、`git diff --name-status` 和 manifest 专项 diff 均为空；`git ls-files --others --exclude-standard` 仅列本 sprint 的七份已有记录；`git diff --check 0bbee7b45e4ce79ed2752785fbdb0fd805357879 HEAD` 无输出，以上退出码均为 0。
- 提交 SHA：`d1c172c1cdf8bca7851453739fb7b5deb526c641`。

### B-5

- 对应：S-5。
- 改动文件：同一 README 新节的可信来源、严格 main 同步、03/04 隔离恢复、本轮全账及后续裁判边界。
- 验证方式：临时只读断言核新节关键证据边界；本 build 未调用可信控制器、QA、source gate 或外层 C01–C12，因此仅核文档表述，不把将来阶段当作已通过。
- 实际命令与输出：追加前执行 `node /private/tmp/cw-3d11e9d3-check.mjs S-5`，因“缺少文末小节”退出 1；追加后及提交后输出 `S-5 PASS：源码、README、固定基线断言成立`，退出 0。`git show --format=fuller --stat --oneline HEAD` 显示仅 README 变动，28 行新增；`git ls-tree HEAD -- packages/brain/scripts/coding-workflow/runner/README.md` 显示 mode `100644`。
- 提交 SHA：`d1c172c1cdf8bca7851453739fb7b5deb526c641`。
