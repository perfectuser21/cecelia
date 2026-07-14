# Contract Draft：watchdog PR 标题 [短号] 匹配

- **Task ID**: d276bdae-e69f-4b87-9ee1-5b0e552acb2b
- **Sprint Dir**: sprints/07141330-watchdog-pr-title-match
- **Issue Ref**: e90c0fbb
- **合同日期**: 2026-07-14
- **journey_type**: bug_fix
- **target_environment**: brain_unit_test

---

## 背景与根因

`packages/brain/src/harness-relay-watchdog.js` 的 `_discoverPrFromGithub` 函数
仅以 `headRefName.includes(short)` 过滤 PR。当 PR 分支名不含任务短号（例如分支名为
`fix/ci-poll-grep` 而任务短号为 `ff0473b1`），函数返回 `null`，
watchdog 误判 run 死亡并触发重点火。

EVA v2 纪律要求 PR 标题必须包含 `[短号]` 方括号形式（如 `fix(ci-poll): xxx [ff0473b1]`），
本修复利用该纪律补充标题匹配，消除误检。

---

## 变更范围（Invariant）

| 约束 | 说明 |
|------|------|
| 只改匹配逻辑 | 仅 `_discoverPrFromGithub` 内过滤条件 + `--json` 字段列表 |
| 标题匹配严格 | 短号必须以 `[短号]` 方括号形式出现，禁止松散子串 |
| MERGED 优先 | MERGED > OPEN，合并两路命中后统一排序 |
| 分支名匹配不回归 | `headRefName.includes(short)` 继续生效 |
| failing test 先行 | 先提交 failing test，再提交修复 |
| gh 命令最小变更 | 仅新增 `title` 字段到 `--json` 参数 |

---

## E2E 验收

### 目标环境

`brain_unit_test`：`packages/brain` Vitest 单元测试套件（无真实 gh CLI 调用，全 mock execFn）。

### 验收流程

1. 在 `packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js` 追加以下三条测试：
   - **FR-2**：标题命中、分支名不含短号 → 修复前 failing，修复后 passing
   - **FR-3**：分支名命中（既有路径回归）
   - **FR-4**：MERGED（标题命中）优先于 OPEN（分支名命中）
2. 先提交含 failing test（FR-2 failing）的 commit
3. 再修改 `harness-relay-watchdog.js`，确认 FR-2 变 passing，FR-3/FR-4 全绿
4. 运行 `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog-pr-discovery.test.js`，全绿

## Test Contract 表

| # | 测试描述 | 输入（mock execFn 返回） | short | 期望结果 | 对应 FR |
|---|---------|------------------------|-------|----------|---------|
| TC-1 | 标题含 [short]，分支名不含 short | `[{ headRefName: 'cp-xxx-no-short', title: 'fix: xxx [abcd1234]', url: 'https://github.com/org/repo/pull/9', state: 'OPEN' }]` | `abcd1234` | 返回该 PR 对象（state=OPEN） | FR-2 |
| TC-2 | 分支名含 short，标题无关 | `[{ headRefName: 'cp-aaaabbbb-ws', title: 'no match', url: 'u-branch', state: 'OPEN' }]` | `aaaabbbb` | 返回该 PR 对象 | FR-3 |
| TC-3 | 同时存在：MERGED（标题命中）+ OPEN（分支名命中） | `[{ headRefName: 'cp-aaaabbbb-ws', title: 'no', url: 'u-open', state: 'OPEN' }, { headRefName: 'other', title: 'fix [aaaabbbb]', url: 'u-merged', state: 'MERGED' }]` | `aaaabbbb` | 返回 MERGED PR | FR-4 |
| TC-4（回归）| MERGED 优先于 OPEN（均由分支名命中）| 已存在于现有测试 `_discoverPrFromGithub MERGED 优先于 OPEN` | `aaaabbbb` | 返回 MERGED | FR-4 回归 |
| TC-5（回归）| 无匹配分支且无标题匹配 → 返回 null | `[{ headRefName: 'cp-unrelated', title: 'no match', url: 'u', state: 'OPEN' }]` | `aaaabbbb` | 返回 null | 边界 |
| TC-6（回归）| 标题含 short 但不是 [short] 方括号形式（松散匹配防御）| `[{ headRefName: 'other', title: 'fix aaaabbbb done', url: 'u', state: 'OPEN' }]` | `aaaabbbb` | 返回 null | FR 铁律 |

---

## 未覆盖真实链路清单

以下场景当前测试未覆盖，留作后续 follow-up（不阻塞本次 bug fix）：

| 场景 | 风险等级 | 说明 |
|------|---------|------|
| gh CLI 真实调用（非 mock） | 低 | 真实网络调用在 CI 不可行；mock 已足够覆盖逻辑 |
| PR 标题含多个 [短号]（如 `[aabb1122] [ccdd3344]`）| 低 | 当前只需命中目标 short 即可，不会误匹配 |
| `title` 字段为 null/undefined（异常 gh 返回）| 低 | `typeof p?.title === 'string'` 防御已在 FR-1 设计中 |
| 超过 100 条 PR（limit=100 溢出）| 低 | 已有 limit 100 注释说明，不在本次 scope |
| 同一任务有 2 个 OPEN PR 均标题命中 | 低 | 当前行为返回列表第一个 OPEN，与分支名命中的既有行为一致 |
