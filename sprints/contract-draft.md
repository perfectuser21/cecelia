# Sprint Contract Draft (Round 2)

> Initiative B1 — Pre-flight 描述长度校验
> Generator: harness-contract-proposer
> Task: defa3c0b-0296-4e63-9bb4-534fa5c2e860
> Round 1 Verdict: REVISION

## Round 2 — 对上轮反馈的处理

| 反馈点 | 处理 |
|---|---|
| WS1 范围声明 4 个导出，DoD 只覆盖 `checkInitiativeDescription` / `buildPreflightFailureResult` 两个；`getMinDescriptionLength` / `DEFAULT_MIN_DESCRIPTION_LENGTH` 未闭合 | 在 `contract-dod-ws1.md` 补 2 条 ARTIFACT，分别校验 `getMinDescriptionLength` 命名导出、`DEFAULT_MIN_DESCRIPTION_LENGTH` 命名导出常量；同时把"赋值 = 60"的字面量校验拆成独立条目，避免"导出形态"与"默认值"两件事混在一起 |
| `dod_machineability = 7 → 目标 ≥ 8`：每条 Test 改写成可粘贴的 exit-code 命令清单 | 全部 ARTIFACT 切换到单行可粘贴命令：`bash -c 'test -f …'` / `bash -c 'grep -cE/-cF/-ciF …'`，仅在 ESM import 路径需匹配单双引号两形态时保留 `node -e`（CI 白名单 `check-dod-purity.cjs` 接受 `bash <args>` 与 `node -e`，不接受裸 `grep`/`test`，所以仍走 `bash -c '…'` 包一层） |
| （可选）"21 个 it"显式拆分 Feature 1 (16) + Feature 2 (5) | `contract-dod-ws1.md` 的 BEHAVIOR 索引区与下文 `## Test Contract` 表格均按 16 + 5 = 21 显式列出，避免后续追加测试时数字漂移 |

测试文件 `tests/ws1/preflight.test.ts` round 2 不变（21 个 it 全部保留）。Red evidence 仍由"`packages/brain/src/preflight.js` 不存在 → `beforeEach` 动态 import 抛 `ERR_MODULE_NOT_FOUND` → 全部 21 个 it fail" 这条结构性事实承担。

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

## Feature 2: 失败回写结构 + 派发入口集成 + 文档

**行为描述**:
Brain 派发 Initiative 类任务（harness pipeline task_type）时，先调用 preflight 校验；校验失败时，调用方通过 `buildPreflightFailureResult(description, options)` 取得形态固定的回写对象，写入任务的 `result` 字段并将状态打成 `rejected_preflight`，同时不创建任何下游子任务。回写对象顶层固定包含 `preflight_failure_reason` 子对象，子对象至少含 `reason`（可读文案）/ `actualLength`（trim 后 code-point 数）/ `threshold`（实际生效阈值）三键。文档（`DEFINITION.md` 或对应运行时说明）记录该校验点的存在，便于主理人和后续维护者读到。

**硬阈值**:
- `buildPreflightFailureResult(description)` 返回值是一个 plain object，顶层键含 `preflight_failure_reason`
- `preflight_failure_reason` 子对象的 `reason` 字段类型为 string，长度 ≥ 10 字符（保证可读，禁止单字 / 空串）
- `preflight_failure_reason.actualLength` 类型为 number，等于 `[...String(description ?? '').trim()].length`
- `preflight_failure_reason.threshold` 类型为 number，等于当次调用生效的阈值（env / options / default）
- `packages/brain/src/dispatcher.js` 含 `from './preflight.js'` 形式的静态 ESM import
- `packages/brain/src/dispatcher.js` 文件中出现字面量字符串 `rejected_preflight`
- `packages/brain/.env.example` 含字面量 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 含子串 `preflight`（大小写不敏感）

**BEHAVIOR 覆盖**（落在 tests/ws1/preflight.test.ts，**Feature 2 = 5 个 it**）:
- it('buildPreflightFailureResult returns plain object with preflight_failure_reason key')
- it('preflight_failure_reason includes reason as string of length >= 10')
- it('preflight_failure_reason.actualLength is trimmed code-point count')
- it('preflight_failure_reason.threshold reflects effective threshold (env or option override)')
- it('buildPreflightFailureResult does not throw on null / undefined description')

**ARTIFACT 覆盖**（落在 contract-dod-ws1.md）:
- `preflight.js` 命名导出 `buildPreflightFailureResult`
- `dispatcher.js` 含 `from './preflight.js'`（静态 ESM import）
- `dispatcher.js` 含字面量 `rejected_preflight`
- `.env.example` 含 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 含 `preflight`（大小写不敏感）

---

## Workstreams

workstream_count: 1

### Workstream 1: Pre-flight 校验模块 + 配置 + 派发集成 + 文档

**范围**:
- 新增 `packages/brain/src/preflight.js`，**4 个命名导出全部**：
  1. `checkInitiativeDescription(description, options?)`（Feature 1 主入口）
  2. `buildPreflightFailureResult(description, options?)`（Feature 2 失败回写工厂）
  3. `getMinDescriptionLength()`（阈值解析；env → 默认）
  4. `DEFAULT_MIN_DESCRIPTION_LENGTH`（常量 = 60）
- `packages/brain/src/dispatcher.js`：在派发 harness pipeline task_type 前 `import` preflight；失败时把 task 标 `rejected_preflight` 并把 `buildPreflightFailureResult(...)` 写进 `result`
- `packages/brain/.env.example` 注册 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 记录"派发前 preflight 描述长度校验"

**大小**: S（实现 + 集成 + 文档预期 < 150 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/preflight.test.ts`（21 个 it = 16 + 5）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/preflight.test.ts` | **21 个 it = Feature 1 (16) + Feature 2 (5)** — 阈值边界 / 空白 / null / 中文 emoji / env 覆盖 / failure 对象结构 | `npx vitest run sprints/tests/ws1/` → 21 failed（`packages/brain/src/preflight.js` 不存在，`beforeEach` 动态 import 抛 `ERR_MODULE_NOT_FOUND`，每个 it 单独 fail） |

### ARTIFACT Test Contract（contract-dod-ws1.md，11 条）

| 编号 | 校验对象 | 命令前缀 |
|---|---|---|
| 1 | `preflight.js` 文件存在 | `bash -c 'test -f …'` |
| 2 | 命名导出 `checkInitiativeDescription` | `bash -c 'grep -cE …'` |
| 3 | 命名导出 `buildPreflightFailureResult` | `bash -c 'grep -cE …'` |
| 4 | 命名导出 `getMinDescriptionLength` | `bash -c 'grep -cE …'`（**round 2 新增**）|
| 5 | 命名导出 `DEFAULT_MIN_DESCRIPTION_LENGTH` | `bash -c 'grep -cE …'`（**round 2 新增**）|
| 6 | `DEFAULT_MIN_DESCRIPTION_LENGTH = 60` 字面值 | `bash -c 'grep -cF …'` |
| 7 | 引用 `INITIATIVE_MIN_DESCRIPTION_LENGTH` 环境变量名 | `bash -c 'grep -cF …'` |
| 8 | `dispatcher.js` 静态 ESM import preflight | `node -e "…"`（保留以同时兼容单双引号） |
| 9 | `dispatcher.js` 含 `rejected_preflight` 字面量 | `bash -c 'grep -cF …'` |
| 10 | `.env.example` 声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH` | `bash -c 'grep -cF …'` |
| 11 | `DEFINITION.md` 记录 preflight | `bash -c 'grep -ciF …'` |
