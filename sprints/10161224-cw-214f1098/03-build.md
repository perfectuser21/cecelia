---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1

- 对应：S-1。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，新增 CLI 参数、默认目录、mtime 排序和空结果判读。
- 先红：运行 `node -e "const fs=require('fs'),a=require('assert'),s=fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md','utf8');a.match(s,/## 运行回执如何判读/);a.match(s,/mtime/);"`，退出码 1，缺少该小节。
- 通过验证：运行 `node --input-type=module <<'NODE'` 内联断言脚本，用 `spawnSync(process.execPath, [cli, '--log-dir', dir, '--json'])` 和不带 `--json` 的模式读取临时目录；实际输出 `S-1 PASS：空目录与不存在目录 JSON=[]、文本提示无记录；README 参数、默认目录及排序说明存在`、`S-1 PASS：两种模式均按 mtime 新到旧排序`。脚本自行创建、删除临时回执，没有新增仓库测试文件。
- 提交：`f1b7b78ff827460e1482b6b92244b45177529f9a`。

### B-2

- 对应：S-2。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，补充各状态、失败原因、非回执 JSON 和 CI fix 摘要判读。
- 先红：运行 `node -e "const fs=require('fs'),a=require('assert'),s=fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md','utf8');a.match(s,/pr-sync-pending\.json/);a.match(s,/ci_fix\.attempts/);"`，退出码 1，缺少待办文件说明。
- 通过验证：运行同一 `node --input-type=module <<'NODE'` 内联断言脚本，临时写入进度、partial、failed、QA、Commander、待办、坏 JSON 和 `cifix-2.json`，真实调用 status CLI 并逐字段断言；实际输出 `S-2 PASS：running/partial/failed/unreadable 分类、失败原因优先级、CI fix 摘要及文件保留`。所有输入仅在临时目录，未修改测试、程序或运行状态。
- 提交：`f1b7b78ff827460e1482b6b92244b45177529f9a`。

### B-3

- 对应：S-3。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，说明缺 PR URL 时 completed 的真实语义和最终合并核对步骤。
- 先红：运行 `node -e "const fs=require('fs'),a=require('assert'),s=fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md','utf8');a.match(s,/pr_url_missing/);a.match(s,/runner\.phase=merged/);"`，退出码 1，缺少 `pr_url_missing` 说明。
- 通过验证：运行同一 `node --input-type=module <<'NODE'` 内联断言脚本，临时构造无 PR URL 的 completed 回执，真实调用 status CLI 两种模式；实际输出 `S-3 PASS：缺 PR 的 completed JSON 含 pr_url_missing，文本隐藏该原因；README 要求核对终态`。只读文档与自造数据，未调用 GitHub、Brain 或生产服务。
- 提交：`f1b7b78ff827460e1482b6b92244b45177529f9a`。

### B-4

- 对应：S-4。
- 改动文件：仅 `packages/brain/scripts/coding-workflow/runner/README.md`；本文件是流水线记录，不入提交。
- 先红：运行 `node -e "const fs=require('fs'),a=require('assert'),s=fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md','utf8');a.match(s,/## 运行回执如何判读/);"`，退出码 1，目标文档段落尚不存在。
- 通过验证：运行 `python3 - <<'PY'` 内联范围断言，固定基线 `1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c`，读取 `git show` 的基线 README 并从当前 README 扣除新增小节，逐字节相等；同时检查 `git diff --name-only <base> HEAD`、暂存区、工作区、全仓 `git ls-files --others --exclude-standard` 和 manifest。前两次内联 Python 因脚本语法错误退出 1，修正后实际输出 `S-4 PASS：原 README 全文字节有序保留，产品仅 README；manifest 相对固定基线零差异；未跟踪文件均为本任务 sprint 记录`。`git diff --check` 与 `git diff --cached --check` 均退出 0；提交后 `git diff HEAD --name-only`、`git diff --cached --name-only` 均为空，固定基线到 HEAD 仅 README。全程未新增仓库测试、未编辑或暂存 manifest，未提交 sprint 文件。
- 提交：`f1b7b78ff827460e1482b6b92244b45177529f9a`。
