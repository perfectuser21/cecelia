---
task_id: 9133ec1c-a24b-4e1d-9ce8-ebadab3abaa2
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---

### B-1

- 对应：S-1
- 改动文件：`packages/brain/scripts/coding-workflow/runner/lib/plan.mjs`
  - 删除 `pad` 辅助函数（无其他引用）。
  - 模块顶层新增 `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', month/day/hour/minute: '2-digit' })`。
  - `stampOf` 用 `formatToParts` 取 month/day/hour/minute 拼接，注释改为「上海时区 MMDDHHmm（与运行机器 TZ 无关）」。
  - `taskNames` 未改，`run-once.mjs` 未改。
- 新增测试：见 B-2（TDD：先写测试，在 `TZ=America/Los_Angeles` 下实测 5 个用例失败，例如 UTC 子进程得到 `10081035`，再改实现）。
- 实际运行：
  - `TZ=America/Los_Angeles node -e "import('./scripts/coding-workflow/runner/lib/plan.mjs').then(m=>console.log(m.stampOf(new Date('2026-10-08T10:35:00Z'))))"` → `10081835`
  - 同命令 `TZ=UTC` → `10081835`
- 提交 SHA：b2b0d8680a53a3f12bf5aba9599eb829eba21ef1

### B-2

- 对应：S-2
- 改动文件：`packages/brain/scripts/coding-workflow/runner/__tests__/plan.test.mjs`
  - import 增加 `execFileSync`、`pathToFileURL`、`stampOf`。
  - `taskNames` 用例由 `new Date(2026, 9, 8, 7, 5)` 改为固定瞬时 `new Date('2026-10-07T23:05:00Z')`，仍断言 stamp `10080705`、branch、sprintDir、runTag、`BRANCH_RE`。
  - 新增 `describe('stampOf')`：`2026-10-08T10:35:00Z` → `10081835`；`2026-12-31T16:00:00Z` → `01010000`；对 `America/Los_Angeles`/`UTC`/`Asia/Shanghai` 各起子进程（设置 `TZ`）断言输出均为 `10081835`。
- 实际运行（均在 `packages/brain` 下）：
  - 实现前 `TZ=America/Los_Angeles npx vitest run scripts/coding-workflow/runner/__tests__/plan.test.mjs`：5 failed | 13 passed（确认测试有效）。
  - 实现后 `npx vitest run scripts/coding-workflow/runner/__tests__/plan.test.mjs`，分别加前缀 `TZ=America/Los_Angeles`、`TZ=UTC`、`TZ=Asia/Shanghai`：三次均为 1 file passed，18 tests passed。
  - 回归 `npx vitest run scripts/coding-workflow`：23 files passed，460 tests passed。
- 提交 SHA：b2b0d8680a53a3f12bf5aba9599eb829eba21ef1（S-1 与 S-2 同一提交）
