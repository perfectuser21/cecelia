---
task_id: 6350b768-b097-4441-84bb-903a8762f430
step: intent
upstream: []
---
# coding workflow runner 状态查看脚本 status.mjs

### I-1
cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs 全部通过，测试覆盖：一份 completed 回执输出含 pr_url，一份 partial 回执输出含 failed_activity 与 reason_code，两份回执按修改时间倒序

### I-2
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <不存在的目录> 退出码为 0 并输出提示没有运行记录

### I-3
cd packages/brain && npx vitest run scripts/coding-workflow/runner 全部通过
