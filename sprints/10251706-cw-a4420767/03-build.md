---
task_id: a4420767-a098-47e1-96ee-710eb033dd85
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

### B-1

对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。新增单任务 JSON、预检命令、仓库优先级与 SHA 校验边界。验证方式：只读 README 和 `new-task.mjs` 的临时静态断言，材料在 `/tmp/cw-a4420767-verify.py`，未新增仓库测试，也未执行建单。实际命令：`python3 /tmp/cw-a4420767-verify.py 1`；实现前输出 `S-1 FAIL: 提交编码任务小节缺失`，实现及提交后输出 `S-1 PASS`，退出码分别为 1、0。提交 SHA：`46d339d0a735f7c18371dad9b503321b8d243cfb`。

### B-2

对应 S-2。改动文件：同一 README。新增两任务批次、项目选择和 `depends_on` 的顺序及领单分支说明。验证方式：临时断言解析 README 中的 JSON，核 key 引用、项目二选一，并对照 `new-task.mjs` 和 `runner/lib/deps.mjs` 的实际分支；未修改仓库测试。实际命令：`python3 /tmp/cw-a4420767-verify.py 2`；实现前输出 `S-2 FAIL: 提交编码任务小节缺失`，提交后输出 `S-2 PASS`，退出码分别为 1、0。提交 SHA：`46d339d0a735f7c18371dad9b503321b8d243cfb`。

### B-3

对应 S-3。改动文件：同一 README。补充真实提交、普通失败与 `task_route_mismatch` 的 ID 核账。验证方式：临时断言从最终 README 删除新增顶层小节后，与固定基线 README 逐字节相等，并核原 `status.mjs` 代码块和源码输出分支；严格遵守只改文档的范围。实际命令：`python3 /tmp/cw-a4420767-verify.py 3`；实现前输出 `S-3 FAIL: 提交编码任务小节缺失`，首次实现后输出 `S-3 FAIL: S3 文字缺失 写入 Brain`，修正文案并提交后输出 `S-3 PASS`，退出码依次为 1、1、0。提交 SHA：`46d339d0a735f7c18371dad9b503321b8d243cfb`。

### B-4

对应 S-4。改动文件：同一 README；未编辑、暂存或提交 `.implementation-source-relations.json`。验证方式：临时断言加固定基线 Git 全量只读检查，无仓库测试或 smoke；发布前 verify 仍由后续控制器独立执行。实际命令：`python3 /tmp/cw-a4420767-verify.py 4`；实现前输出 `S-4 FAIL: 提交编码任务小节缺失`，提交后输出 `S-4 PASS`，退出码分别为 1、0。另执行 `git rev-list --parents 9834f4852ce3436252222b1fdfaf9d72e72bad24..HEAD`，输出唯一提交 `46d339d0a735f7c18371dad9b503321b8d243cfb` 及其父 `9834f4852ce3436252222b1fdfaf9d72e72bad24`；`git diff --name-status 9834f4852ce3436252222b1fdfaf9d72e72bad24 HEAD` 和 `git diff-tree -r --raw --no-commit-id 9834f4852ce3436252222b1fdfaf9d72e72bad24 HEAD` 均仅列 README 100644 修改。`git diff --cached --name-status`、`git diff --name-status` 均无输出；`git ls-files --others --exclude-standard` 仅列本任务 sprint 的九个现有流水线 Markdown。`git diff --binary --full-index 9834f4852ce3436252222b1fdfaf9d72e72bad24 HEAD -- packages/brain/scripts/coding-workflow/runner/README.md .implementation-source-relations.json` 仅显示 README 新增的 75 行，manifest 无差异；以上命令退出码均为 0。提交 SHA：`46d339d0a735f7c18371dad9b503321b8d243cfb`。

### B-5

对应 S-5。改动文件：同一 README，未修改程序、测试、历史报告或受控来源清单。验证方式：本阶段只用临时静态断言及当前 Git 事实核文档和范围；发布后预览 QA、受保护来源门、03/04 隐藏后恢复、完整原生全账及后续终态须由对应控制器在实际发生时核验，当前没有声称完成。实际命令：`python3 /tmp/cw-a4420767-verify.py 5`；实现前输出 `S-5 FAIL: 提交编码任务小节缺失`，提交后输出 `S-5 PASS`，退出码分别为 1、0。联合复验命令 `python3 /tmp/cw-a4420767-verify.py 1 2 3 4 5 && git diff --check` 输出 S-1 至 S-5 五行 `PASS`，退出码 0；`git status --porcelain=v1` 仅输出本任务 sprint 目录为未跟踪，提交中没有 sprint 文件。纯文档改动没有有效 API 回归 smoke，未伪造 smoke。提交 SHA：`46d339d0a735f7c18371dad9b503321b8d243cfb`。
