# Sprint Contract Draft (Round 3)

> Initiative B1 — Pre-flight 描述长度校验
> Generator: harness-contract-proposer
> Task: defa3c0b-0296-4e63-9bb4-534fa5c2e860
> Round 1 Verdict: REVISION
> Round 2 Verdict: REVISION

## Round 3 — 对上轮反馈的处理

| 反馈点 | 处理 |
|---|---|
| **R3 vitest beforeEach 抛错的 fail 计数不稳定** — 不同 vitest 版本里 `beforeEach` 抛错可能整块 skip 而非 21 个独立 fail，Red 证据失真 | (a) `Test Contract` "预期红证据"列改写为可粘贴 shell 命令 — 形如 `npx vitest run sprints/tests/ws1/ 2>&1 \| grep -cE 'FAIL\|✗'` 且阈值用 `test -ge` 显式断言；(b) 新增 `## 依赖事实（vitest 版本锁）` 章节，把 `packages/brain/package.json` 里的 `"vitest": "^1.6.1"` 写进合同事实并附 grep 验证命令；(c) 测试文件改造：把"动态 import 模块"从 `beforeEach` 提到模块顶层 `await import(...)` 替代，让 21 个 it 各自命中 `ReferenceError` / `TypeError` 而不是被 hook 抛错整块 skip — 这样无论 vitest 版本如何，每个 it 都独立 fail 一次 |
| **scope_match_prd = 7 → 目标 ≥ 8**：当前只 grep 字面量 `rejected_preflight` 不足以证明 FR-002 / US-001"不创建子任务"语义 | 同时走 ARTIFACT + BEHAVIOR 双轨补强：(a) `preflight.js` 新增第 5 个命名导出 `applyDispatchPreflight({task, createSubtask})` — 这是 dispatcher 派发 harness pipeline task_type 时的 gate 函数（DI 注入 `createSubtask` 让 mock 可断言"未被调用"）；(b) `contract-dod-ws1.md` 加 2 条 ARTIFACT — 校验 `applyDispatchPreflight` 命名导出存在 + dispatcher.js 含 `applyDispatchPreflight(` 实际调用；(c) `tests/ws1/preflight.test.ts` 新增 3 个 it（24 个 it 总数），覆盖：拒绝场景 createSubtask 未被调用 / 通过场景 createSubtask 恰好被调用 1 次 / 拒绝结果 result 子对象三键完整 — 这样"调 preflight + 写 result + **不创建子任务**"三段式语义被运行时 mock 直接证伪 |

测试文件 `tests/ws1/preflight.test.ts` 在 round 3 从 21 个 it 扩到 24 个 it（新增 3 个集成 BEHAVIOR it 测 `applyDispatchPreflight`）。Red evidence 仍由"`packages/brain/src/preflight.js` 不存在 → import 抛 `ERR_MODULE_NOT_FOUND` → 24 个 it 各自 fail" 这条结构性事实承担，但红证据计数改为 shell-verifiable。

---

## 依赖事实（vitest 版本锁）

合同前提：`packages/brain/package.json` devDependencies 含 `"vitest": "^1.6.1"`。Reviewer 实跑前应先核对此事实。

**事实校验命令**（exit-code = 0 表示事实成立）:

```bash
bash -c 'grep -cE "\"vitest\":\s*\"\^1\.6" packages/brain/package.json'
```

预期输出: `1`（恰好一行匹配）。

vitest 1.6 行为契约（与本合同 Red evidence 解释相关）：
- `await import('non-existent-module')` 在测试体内抛出 → 被 vitest 捕获为该 it 的失败，不传染其他 it
- `beforeEach` 抛出在 1.6 中**会**导致同 describe 内所有 it 各自 fail（每个 it 在执行前重跑 beforeEach），而非整块 skip — 但为避免依赖此版本特性，本轮把模块加载逻辑下沉进每个 it（见测试文件改造），消除版本敏感性

---

## Feature 1: Initiative 描述长度 Pre-flight 校验函数

**行为描述**:
Initiative 描述在派发前需通过最低长度校验。校验对象是描述字符串去除两端空白后的字符数（按 Unicode code-point 计；多字节字符如中文、emoji 各按 1 计）。阈值默认 60，可由环境变量 `INITIATIVE_MIN_DESCRIPTION_LENGTH` 覆盖；调用方亦可通过 options 直接传入 threshold 覆盖环境变量。当处理后的长度 ≥ 阈值时校验通过，否则失败并返回包含实际长度、阈值、可读原因文案的结构化对象。校验函数无副作用、无内部缓存，对同一输入多次调用结果一致；环境变量可在调用之间修改并立即生效。

**硬阈值**:
- `DEFAULT_MIN_DESCRIPTION_LENGTH` 常量 = `60`
- 通过条件: `[...description.trim()].length >= threshold`
- 拒绝条件: `[...description.trim()].length < threshold`
- `description` 为 `null` / `undefined` → 视为长度 0（即拒绝）
- 字符长度统计采用 Unicode code-point 计数（`[...str].length`），中文 = 1，emoji（含 surrogate pair）= 1
- `INITIATIVE_MIN_DESCRIPTION_LENGTH` 环境变量为正整数时覆盖默认；非数 / 缺失 / `<= 0` 一律回落到 `60`
- options.threshold 优先级高于环境变量

**BEHAVIOR 覆盖**（落在 tests/ws1/preflight.test.ts，**Feature 1 = 16 个 it**）:
- it('returns ok=true when description length equals threshold')
- it('returns ok=true when description length exceeds threshold')
- it('returns ok=false with actualLength and threshold when description shorter than threshold')
- it('returns ok=false when description is empty string')
- it('returns ok=false when description is whitespace-only after trim')
- it('returns ok=false when description is null')
- it('returns ok=false when description is undefined')
- it('counts CJK characters as one code point each (60 Chinese chars passes)')
- it('counts CJK characters as one code point each (59 Chinese chars fails with actualLength=59)')
- it('counts emoji surrogate pair as one code point each')
- it('uses options.threshold when provided, overriding env var')
- it('reads INITIATIVE_MIN_DESCRIPTION_LENGTH env var on each call (no caching)')
- it('falls back to default 60 when env var is missing')
- it('falls back to default 60 when env var is non-numeric')
- it('falls back to default 60 when env var is zero or negative')
- it('produces identical result for repeated calls with same input (no side-effects)')

**ARTIFACT 覆盖**（落在 contract-dod-ws1.md）:
- 文件 `packages/brain/src/preflight.js` 存在
- `preflight.js` 命名导出 `checkInitiativeDescription`
- `preflight.js` 命名导出 `getMinDescriptionLength`
- `preflight.js` 命名导出常量 `DEFAULT_MIN_DESCRIPTION_LENGTH`
- `preflight.js` 字面量赋值 `DEFAULT_MIN_DESCRIPTION_LENGTH = 60`
- `preflight.js` 引用 `INITIATIVE_MIN_DESCRIPTION_LENGTH` 环境变量名

---

## Feature 2: 失败回写结构 + 派发入口集成（DI gate）+ 文档

**行为描述**:
Brain 派发 harness pipeline task_type 时，调用 `applyDispatchPreflight({task, createSubtask})` 作为派发前置 gate。该 gate 函数行为：

1. 取 `task.description`（可能为 null / undefined）调用 `checkInitiativeDescription(...)`
2. 若校验失败 → 返回 `{status: 'rejected_preflight', result: buildPreflightFailureResult(task.description)}`，**保证不调用** 注入的 `createSubtask`（DI 形式可由 mock 直接断言"未被调用"）
3. 若校验通过 → 调用 `await createSubtask(...)` 恰好 1 次，返回 `{status: 'dispatched'}`

`buildPreflightFailureResult(description, options?)` 返回形态固定的 plain object，顶层固定包含 `preflight_failure_reason` 子对象，子对象至少含 `reason`（可读文案）/ `actualLength`（trim 后 code-point 数）/ `threshold`（实际生效阈值）三键。

`packages/brain/src/dispatcher.js` 在派发 harness pipeline task_type 入口处 import 并调用 `applyDispatchPreflight`，把返回的 `result` 直接写入任务 `result` 字段、把 `status` 打成 `rejected_preflight`（拒绝路径），通过路径不在此处展开（沿用既有 createSubtask 链路）。文档 `DEFINITION.md` 记录该校验点。

**硬阈值**:
- `applyDispatchPreflight({task, createSubtask})` 拒绝场景：返回 `{status: 'rejected_preflight', result: {...}}`，且 `createSubtask` mock 在整个调用周期内 0 次调用
- `applyDispatchPreflight({task, createSubtask})` 通过场景：`createSubtask` mock 恰好 1 次调用
- `buildPreflightFailureResult(description)` 返回值是 plain object，顶层键含 `preflight_failure_reason`
- `preflight_failure_reason` 子对象的 `reason` 字段类型为 string，长度 ≥ 10 字符
- `preflight_failure_reason.actualLength` 类型为 number，等于 `[...String(description ?? '').trim()].length`
- `preflight_failure_reason.threshold` 类型为 number，等于当次调用生效的阈值（env / options / default）
- `packages/brain/src/dispatcher.js` 含 `from './preflight.js'` 形式的静态 ESM import
- `packages/brain/src/dispatcher.js` 含字面量 `applyDispatchPreflight(`（call site，不仅 import）
- `packages/brain/src/dispatcher.js` 文件中出现字面量字符串 `rejected_preflight`
- `packages/brain/.env.example` 含字面量 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 含子串 `preflight`（大小写不敏感）

**BEHAVIOR 覆盖**（落在 tests/ws1/preflight.test.ts，**Feature 2 = 8 个 it**，round 3 从 5 → 8）:
- it('buildPreflightFailureResult returns plain object with preflight_failure_reason key')
- it('preflight_failure_reason includes reason as string of length >= 10')
- it('preflight_failure_reason.actualLength is trimmed code-point count')
- it('preflight_failure_reason.threshold reflects effective threshold (env or option override)')
- it('buildPreflightFailureResult does not throw on null / undefined description')
- **(R3 新增)** it('applyDispatchPreflight does not call createSubtask when description shorter than threshold')
- **(R3 新增)** it('applyDispatchPreflight calls createSubtask exactly once when description passes threshold')
- **(R3 新增)** it('applyDispatchPreflight rejected result includes preflight_failure_reason with reason/actualLength/threshold all populated')

**ARTIFACT 覆盖**（落在 contract-dod-ws1.md）:
- `preflight.js` 命名导出 `buildPreflightFailureResult`
- `preflight.js` 命名导出 `applyDispatchPreflight`（**round 3 新增**）
- `dispatcher.js` 含 `from './preflight.js'`（静态 ESM import）
- `dispatcher.js` 含 `applyDispatchPreflight(` 实际调用站点（**round 3 新增**）
- `dispatcher.js` 含字面量 `rejected_preflight`
- `.env.example` 含 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 含 `preflight`（大小写不敏感）

---

## Workstreams

workstream_count: 1

### Workstream 1: Pre-flight 校验模块 + 配置 + 派发集成 + 文档

**范围**:
- 新增 `packages/brain/src/preflight.js`，**5 个命名导出全部**：
  1. `checkInitiativeDescription(description, options?)`（Feature 1 主入口）
  2. `buildPreflightFailureResult(description, options?)`（Feature 2 失败回写工厂）
  3. `getMinDescriptionLength()`（阈值解析；env → 默认）
  4. `DEFAULT_MIN_DESCRIPTION_LENGTH`（常量 = 60）
  5. `applyDispatchPreflight({task, createSubtask})`（**round 3 新增**；派发 gate，DI 注入 createSubtask）
- `packages/brain/src/dispatcher.js`：在派发 harness pipeline task_type 前 import preflight 并调用 `applyDispatchPreflight`；失败时把 task 标 `rejected_preflight` 并把 `applyDispatchPreflight` 返回的 `result` 写进任务 `result`，**且不进入 createSubtask 分支**（由 DI gate 自然保证）
- `packages/brain/.env.example` 注册 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 记录"派发前 preflight 描述长度校验"

**大小**: S（实现 + 集成 + 文档预期 < 180 行；round 3 + applyDispatchPreflight 增加约 20-30 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/preflight.test.ts`（**24 个 it = Feature 1 (16) + Feature 2 (8)**）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（可粘贴 shell，exit 0 = 红证据成立） |
|---|---|---|---|
| WS1 | `tests/ws1/preflight.test.ts` | **24 个 it = Feature 1 (16) + Feature 2 (8)** — 阈值边界 / 空白 / null / 中文 emoji / env 覆盖 / failure 对象结构 / **dispatch gate（createSubtask mock 未调用）** | `bash -c 'cd /workspace && test "$(npx vitest run sprints/tests/ws1/ --reporter=verbose 2>&1 \| grep -cE "FAIL\|✗")" -ge 24'` |

> 红证据命令解释：在 Workstream 1 实现前 `packages/brain/src/preflight.js` 不存在，每个 it 体内的 `await import(...)` / 顶层 import 抛 `ERR_MODULE_NOT_FOUND`，触发 24 个独立 it failure。grep 命中 `FAIL` 或 `✗` 行计数 ≥ 24 时 `test -ge` 退出码 0，红证据成立。Reviewer 复跑：先 `cd packages/brain && npm install`（本仓库未在 root 装 vitest），再切回 `/workspace` 跑命令。

### ARTIFACT Test Contract（contract-dod-ws1.md，**13 条**，round 3 从 11 → 13）

| 编号 | 校验对象 | 命令前缀 |
|---|---|---|
| 1 | `preflight.js` 文件存在 | `bash -c 'test -f …'` |
| 2 | 命名导出 `checkInitiativeDescription` | `bash -c 'grep -cE …'` |
| 3 | 命名导出 `buildPreflightFailureResult` | `bash -c 'grep -cE …'` |
| 4 | 命名导出 `getMinDescriptionLength` | `bash -c 'grep -cE …'` |
| 5 | 命名导出 `DEFAULT_MIN_DESCRIPTION_LENGTH` | `bash -c 'grep -cE …'` |
| 6 | `DEFAULT_MIN_DESCRIPTION_LENGTH = 60` 字面值 | `bash -c 'grep -cF …'` |
| 7 | 引用 `INITIATIVE_MIN_DESCRIPTION_LENGTH` 环境变量名 | `bash -c 'grep -cF …'` |
| 8 | 命名导出 `applyDispatchPreflight`（**round 3 新增**）| `bash -c 'grep -cE …'` |
| 9 | `dispatcher.js` 静态 ESM import preflight | `node -e "…"` |
| 10 | `dispatcher.js` 含 `applyDispatchPreflight(` 实际调用（**round 3 新增**）| `bash -c 'grep -cF …'` |
| 11 | `dispatcher.js` 含 `rejected_preflight` 字面量 | `bash -c 'grep -cF …'` |
| 12 | `.env.example` 声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH` | `bash -c 'grep -cF …'` |
| 13 | `DEFINITION.md` 记录 preflight | `bash -c 'grep -ciF …'` |
