# Sprint PRD：watchdog PR 反查补标题匹配

- **Task ID**: d276bdae-e69f-4b87-9ee1-5b0e552acb2b
- **Sprint Dir**: sprints/07141330-watchdog-pr-title-match
- **Issue Ref**: e90c0fbb
- **创建日期**: 2026-07-14

---

## 背景

2026-07-14，task ff0473b1（fix(ci-poll)）的 PR #3869 已 OPEN 且 CI 在跑，watchdog 仍判定 run 死亡并重点火 attempt=2。

根因：`_discoverPrFromGithub` 仅按 `headRefName.includes(short)` 匹配。该 PR 的分支名不包含任务短号，导致反查返回 null，触发不应发生的重点火。

EVA v2 纪律规定 PR 标题必须以 `[短号]` 方括号形式携带任务 ID，本次补充标题匹配以利用该纪律。

---

## Invariant 约束

1. **只改匹配逻辑**：仅修改 `_discoverPrFromGithub` 内的过滤条件及配套 `gh` 命令的 `--json` 字段列表，不碰重点火、熔断、收口、evaluator gate 等任何其他路径。
2. **标题匹配必须严格**：短号必须以 `[短号]` 方括号形式出现于 PR 标题中（如 `[ff0473b1]`），禁止松散子串匹配，防止误匹配不相关 PR。
3. **MERGED 优先于 OPEN**：当同一任务同时存在 MERGED 与 OPEN 的 PR 匹配时，必须优先返回 MERGED，保持既有语义不变。
4. **分支名匹配不回归**：`headRefName.includes(short)` 的既有匹配路径必须继续生效，标题匹配是补充，不是替换。
5. **failing test 先行**：必须先提交能复现漏检的 failing test，再提交修复，顺序不可颠倒。
6. **gh 命令变更最小化**：`gh pr list --json` 仅新增 `title` 字段，其余参数（`--state all --limit 100` 等）不变。

---

## 累积 FR

### FR-1：补充 PR 标题 `[短号]` 匹配

**文件**：`packages/brain/src/harness-relay-watchdog.js`，函数 `_discoverPrFromGithub`

- `gh pr list` 的 `--json` 参数增加 `title` 字段（现为 `headRefName,url,state`，改为 `headRefName,title,url,state`）
- 过滤逻辑从仅 `headRefName.includes(short)` 扩展为：`headRefName.includes(short) || (typeof p?.title === 'string' && p.title.includes('[' + short + ']'))`
- MERGED 优先逻辑（`matches.find(MERGED) || matches.find(OPEN)`）保持不变，合并 headRefName 与 title 两路命中的 matches 后一起排优先级

### FR-2：failing test — 标题命中但分支名不含短号

**文件**：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`

- 新增 `_discoverPrFromGithub` 单元测试：
  - mock `execFn` 返回 `[{ headRefName: 'cp-xxx-no-short', title: 'fix: xxx [abcd1234]', url: 'https://...', state: 'OPEN' }]`，`short = 'abcd1234'`
  - 修复前：函数返回 `null`（failing）
  - 修复后：函数返回该 PR 对象（passing）

### FR-3：回归保护 — 分支名命中既有行为

**文件**：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`

- 确认既有用例：headRefName 含短号时函数正确返回 PR，结果不回归

### FR-4：回归保护 — MERGED 优先于 OPEN

**文件**：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`

- 确认或新增用例：同一任务同时有 MERGED（标题命中）与 OPEN（分支名命中）时，返回 MERGED 那条

---

## NFR

- **测试覆盖**：`_discoverPrFromGithub` 的三条路径（分支名命中、标题命中、MERGED 优先）均有独立断言
- **CI 合规**：修改后 `packages/brain` 下现有所有 harness-relay-watchdog 测试必须全绿，brain-ci.yml 全通过
- **变更范围**：git diff 中只有 `harness-relay-watchdog.js` 与 `harness-relay-watchdog.test.js` 被修改（+ sprint-prd.md），不触及其他文件
- **可读性**：新过滤条件提取为具名内联函数或注释，说明"分支名 OR 标题 [短号]"的意图

---

journey_type: bug_fix
target_environment: brain_unit_test
