## Brain {VERSION} — coding harness：合并门合并后的 Brain 回写不再被删分支吞掉

- canary 2（#6160）合并门按批准 head 合并成功，Brain 任务却没有 `result.merge`。根因：#6167 给合并加了 `--delete-branch`，合并门合并之后才去远端分支读 `01-intent.md` 取 task_id，分支已删、取不到，回写被静默跳过、连日志都没有（任务 2a049ff4）。
- 改为合并前取 task_id；取不到时记日志「找不到 task_id，合并结果没有回写 Brain」，不再静默。
- 测试假 gh 合并带 `--delete-branch` 时同真 gh 删远端分支；「合并成功 → Brain 回写 merge」测试改为 Brain 里真有该任务（原测试 PATCH 404 也算通过，掩盖了问题）。
