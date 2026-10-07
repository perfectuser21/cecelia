## Brain {VERSION} — coding workflow 第一刀：intent→spec 两步 md 链（json-stdio-v1 活动）

- 新增 `packages/brain/scripts/coding-workflow/`：`coding_spec` 契约 + intent / spec / chain_check / publish 四个 json-stdio-v1 活动，跑在 PR #5783 通用活动执行器上；每步产出带上游引用（task_id + `文件#锚点`）的 md，chain_check 程序判链完整，publish 只提交 sprint 目录并开草稿 PR
- 安全边界：sprint_dir 拒绝绝对路径/`..`/工作区根、git 一律 `--literal-pathspecs`；spec 子进程剥离 `CLAUDECODE`/`CLAUDE_CODE_*` 与 `GIT_DIR` 等、禁用 Bash、越界写判 fatal；不加 `--no-verify`（publish 预算 900s 容纳 pre-push quickcheck）
- 端到端实证：真实任务 8ad60102 经执行器四活动全 completed，PR #6020 含 01-intent.md → 02-spec.md；超时探针 spec 判 retryable/activity_timeout 并重试 2 次、无孤儿进程
- 决策 896fb590 / 09ffb675 / 22ef1a72
