---
task_id: 6350b768-b097-4441-84bb-903a8762f430
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# coding workflow runner 状态查看脚本 status.mjs —— 构建记录

### B-1
- 对应：S-1
- 改动文件：新增 `packages/brain/scripts/coding-workflow/runner/status.mjs`（导出 `collectStatus(logDir)`、`formatStatus(rows)`；CLI 支持 `--log-dir`、`--json`，缺省用 `loadConfig().logDir`；复用 `summarizeReceipt`；进度快照记 `running`，坏 JSON 记 `unreadable`；任何情况 `exitCode=0`）
- 新增测试：见 B-2
- 实际运行命令：`node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /tmp/cw-status-not-exist-$$; echo "exit=$?"`
- 输出摘要：`没有运行记录（/tmp/cw-status-not-exist-2204）`，`exit=0`
- 提交 SHA：3e1d93ec7cd70e08c567fec905122ed16feb0ba6

### B-2
- 对应：S-2
- 改动文件：新增 `packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs`
- 新增测试（7 条）：completed 含 pr_url；partial 含 failed_activity=build 与 reason_code=tests_failed；按 mtime 倒序（函数 + CLI 文本）；`--json` 输出可解析数组；忽略 `.log`；进度快照=running 与坏 JSON=unreadable 互不影响；目录不存在时 `collectStatus` 返回 `[]`、CLI 退出 0 且含「没有运行记录」
- TDD 红：先写测试后运行 `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs` → `Failed to load url ../status.mjs ... Does the file exist?`，`Test Files 1 failed`
- TDD 绿：实现后同命令 → `status.test.mjs (7 tests)`，`Tests 7 passed (7)`
- 提交 SHA：3e1d93ec7cd70e08c567fec905122ed16feb0ba6

### B-3
- 对应：S-3
- 改动文件：无（`run-once.mjs`、`lib/*.mjs` 未修改，仅被 `status.mjs` import）
- 新增测试：无
- 实际运行命令：`cd packages/brain && npx vitest run scripts/coding-workflow/runner`
- 输出摘要：`Test Files 10 passed (10)`，`Tests 92 passed (92)`（run-once 19、run-once-recovery 11、plan 18、run-once-cifix 9、install 9、runner-sh 6、status 7、run-once-deps 8、run-once-retention 3、sandbox-env 2）
- 提交 SHA：3e1d93ec7cd70e08c567fec905122ed16feb0ba6（与 B-1/B-2 同一提交）
