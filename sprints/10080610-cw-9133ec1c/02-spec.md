---
task_id: 9133ec1c-a24b-4e1d-9ce8-ebadab3abaa2
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2"]
---

### S-1

对应：I-1

改动文件：`packages/brain/scripts/coding-workflow/runner/lib/plan.mjs`

- 删除依赖本机时区的 `pad(date.getMonth()+1)/getDate()/getHours()/getMinutes()` 写法，同时不再需要 `pad` 辅助函数（若无其他引用则一并删除）。
- `stampOf(date)` 改为固定用 `Asia/Shanghai` 时区取 MMDDHHmm：模块顶层建一个 `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })`，用 `formatToParts(date)` 取 month/day/hour/minute 四段拼接（注意 `hourCycle: 'h23'` 避免午夜出现 `24`）。
- 更新 `stampOf` 的注释为「上海时区 MMDDHHmm（与运行机器 TZ 无关）」。
- `taskNames` 的签名与返回结构不变（`branch`、`sprintDir`、`runTag` 仍由同一个 `stamp` 派生），`run-once.mjs` 无需改动。

验证：
- 断言：`stampOf(new Date('2026-10-08T10:35:00Z'))` 严格等于 `'10081835'`。
- 边界断言：`stampOf(new Date('2026-12-31T16:00:00Z'))` 为 `'01010000'`（跨日/跨年且午夜不是 `24`）。
- 命令：`cd packages/brain && TZ=America/Los_Angeles node -e "import('./scripts/coding-workflow/runner/lib/plan.mjs').then(m=>console.log(m.stampOf(new Date('2026-10-08T10:35:00Z'))))"` 与同命令 `TZ=UTC` 输出均为 `10081835`。

### S-2

对应：I-2

改动文件：`packages/brain/scripts/coding-workflow/runner/__tests__/plan.test.mjs`

- import 增加 `stampOf`，并增加 `node:child_process` 的 `execFileSync`（若尚未导入）。
- 修改现有 `taskNames` 用例：`new Date(2026, 9, 8, 7, 5)`（本地时间构造，随时区变化）改为固定瞬时 `new Date('2026-10-07T23:05:00Z')`（上海 10-08 07:05），仍断言 stamp `10080705`、branch、sprintDir、runTag 及 `BRANCH_RE`。
- 新增 `describe('stampOf')`：
  1. `new Date('2026-10-08T10:35:00Z')` → `'10081835'`；
  2. 午夜与跨年边界 `2026-12-31T16:00:00Z` → `'01010000'`；
  3. 跨时区用例：对 `['America/Los_Angeles', 'UTC', 'Asia/Shanghai']` 逐个用 `execFileSync(process.execPath, ['--input-type=module', '-e', <import plan.mjs 并打印 stampOf('2026-10-08T10:35:00Z')>], { env: { ...process.env, TZ } })` 起子进程，断言输出都等于 `10081835`（plan.mjs 路径用 `pathToFileURL` 由 `HERE` 拼出）。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/plan.test.mjs` 全部通过。
- 再分别以 `TZ=America/Los_Angeles` 与 `TZ=UTC` 前缀运行同一命令，结果均全部通过。
- 用例有效性：旧实现在 `TZ=America/Los_Angeles` 下对该瞬时返回 `10080335`，新增的跨时区用例会因此失败；新实现下恒为 `10081835`。
