---
task_id: d96eab6d-6e93-41c2-91c2-945cb19ffc51
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# runner 状态查看显示 CI 自动修复记录——实现规格

### S-1
对应：I-1

改动文件：
- `packages/brain/scripts/coding-workflow/runner/status.mjs`

实现：
1. 从 `./lib/cifix-scan.mjs` 引入 `readState`（`readState({ logDir }, prNumber)` 读 `<logDir>/cifix-<pr>.json`，坏文件/不存在返回 `{ attempts: [] }`）。
2. `collectStatus` 扫目录时跳过 `cifix-<数字>.json`（正则 `/^cifix-\d+\.json$/`），它们是 CI 修复状态文件，不是任务回执，不得成为任务行。
3. 每个任务行：若 `pr_url` 匹配 `/\/pull\/(\d+)(?:[/?#]|$)/`，取 PR 号读 `readState`；`attempts.length > 0` 时加字段 `ci_fix: { attempts: <次数>, last_result: <最后一次 attempts[n-1].result ?? null> }`，否则 `ci_fix: null`。无 pr_url 的行（running/unreadable 等）`ci_fix: null`。`--json` 输出随之带该字段。
4. `formatStatus`：`ci_fix` 非空时在该行末尾追加 `  ci_fix=<次数>次 last=<last_result ?? '-'>`（completed 行跟在 pr_url 后，其他状态行跟在 reason_code 后）。

验证（新增于 `packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs`）：
- 构造回执 `{ status: 'completed', outputs: { pr_url: 'https://github.com/x/y/pull/77' } }` 与 `cifix-77.json` = `{ attempts: [{ pr: 77, result: 'push_failed' }, { pr: 77, result: 'pushed' }] }`；
  - 断言 `collectStatus` 该行 `ci_fix` toEqual `{ attempts: 2, last_result: 'pushed' }`；
  - 断言 `formatStatus(rows)` 中含该 task_id 的那一行包含 `ci_fix=2次` 与 `pushed`；
  - 断言行数不包含 task_id 为 `cifix-77` 的行（状态文件不被当成任务）。
- 命令：`cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs` 全部通过（含原有 7 条用例）。

### S-2
对应：I-2

改动文件：
- `packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs`（仅测试；实现由 S-1 第 3、4 点保证）

验证：
- 新增用例：使用原 `makeLogDir()`（COMPLETED_ID 的 pr_url 为 `.../pull/1`，目录中无 `cifix-1.json`），断言该行 `ci_fix` 为 `null`，且 `formatStatus(rows)` 中 COMPLETED_ID 行与 PARTIAL_ID 行均不包含 `ci_fix` 字样。
- 同一用例再加一个存在 `cifix-77.json` 的任务时，断言无 cifix 文件的 COMPLETED_ID 行仍不含 `ci_fix`（防止串号）。
- 命令同 S-1。

### S-3
对应：I-3

改动文件：无额外改动（S-1、S-2 的改动不得破坏 runner 其他测试；`lib/cifix-scan.mjs` 只被 import、不修改）。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/runner` 全部通过（含 run-once-cifix / run-once-retention 等既有用例）。
