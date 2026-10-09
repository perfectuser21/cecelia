---
task_id: d96eab6d-6e93-41c2-91c2-945cb19ffc51
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# build 总结

### B-1
- 对应：S-1
- 改动文件：`packages/brain/scripts/coding-workflow/runner/status.mjs`
  - 从 `./lib/cifix-scan.mjs` 引入 `readState`
  - `collectStatus` 跳过 `/^cifix-\d+\.json$/` 状态文件
  - 每行按 pr_url（`/\/pull\/(\d+)(?:[/?#]|$)/`）读 cifix 状态，有记录时 `ci_fix: { attempts, last_result }`，否则 `null`（`--json` 随之带出）
  - `formatStatus` 在 `ci_fix` 非空时行尾追加 `  ci_fix=<次数>次 last=<last_result ?? '-'>`
- 新增测试：`__tests__/status.test.mjs` 用例「有 cifix 状态文件的任务带 ci_fix 摘要，状态文件本身不成为任务行」（pull/77 + cifix-77.json 两次尝试 → `{ attempts: 2, last_result: 'pushed' }`，文本行含 `ci_fix=2次` 与 `pushed`，无 `cifix-77` 任务行）
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs`
  - 实现前：`Tests  2 failed | 7 passed (9)`（`ci_fix` 为 undefined）
  - 实现后：`Test Files  1 passed (1)`，`Tests  9 passed (9)`
- 提交 SHA：79c2391f4399865a17beaeab6c2e7a19468eb550

### B-2
- 对应：S-2
- 改动文件：`packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs`（仅测试）
- 新增测试：用例「没有 cifix 状态文件的任务 ci_fix 为 null 且文本行不含 ci_fix」——原 `makeLogDir()` 下 COMPLETED_ID 行 `ci_fix` 为 null，COMPLETED_ID / PARTIAL_ID 文本行均不含 `ci_fix`；再加入 pull/77 任务与 `cifix-77.json` 后，COMPLETED_ID 仍为 null 且不含 `ci_fix`（防串号），新任务行含 `ci_fix=1次`
- 测试命令：同 B-1，实现前该用例失败（`expected undefined to be null`），实现后 9/9 通过
- 提交 SHA：79c2391f4399865a17beaeab6c2e7a19468eb550

### B-3
- 对应：S-3
- 改动文件：无额外改动（`lib/cifix-scan.mjs` 只被 import，未修改）
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/runner`
  - 输出：`Test Files  10 passed (10)`，`Tests  94 passed (94)`
- 提交 SHA：79c2391f4399865a17beaeab6c2e7a19468eb550
