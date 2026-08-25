# Sprint Contract Draft (Round 1) — kernel validation clock 按 fix 轮自动顺延（有界）[r71]

> journey_type: autonomous ｜ target_environment: local_api
> 锚定: journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29, step_id=none（PrepPRD 未锚定）
> contract-gate: present (cecelia worktree, 代码层 Contract Gate 生效)
> gp-anchor: skipped (product-map.json not found — cecelia 仓无 product-map/generated/product-map.json)
> map radius: [MAP_NOT_CONFIGURED]（task.payload.map_scope/map_repo 未配置，本轮不跑 radius 现算，无 must_run_assertions 注入）
> runtime: postgres=false（纯函数 sprint，验收不依赖 DB/Brain server）

## 现状事实（起草前实测，SSOT）

- `packages/brain/src/orchestrator/validation-clock.js` **已存在**，导出 `resolveValidationClock({action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin})`。
- 当前实现：`firstValidationOrigin` = decisionLog 中 `spawn:generator` / `spawn:generator-fix` / 带 `validation_origin=verified_existing_pr` 的 `spawn:evaluator` 行里 **hop 最小**（最早）的一行；对该行取 `persistedClock`。→ 即 pipeline deadline 恒以**最早 generator** 起点 + `timeout_seconds` 起算，fix 轮不顺延。
- 实测（本机真跑）：3 个 fix 轮（起点 00:00 / fixes 01:20、02:40、04:00，timeout=5400s）下 `resolveValidationClock({action:'spawn:evaluator', ...})` 返回 `{pipeline_started_at:'…00:00', deadline_at:'…01:30'}` → deadline 早已过期 → 长跑 run 被判 `automation_deadline_exceeded`（r50/r51 手术实录根因）。
- `loop.js` 在每个 validation 动作 append 决策行时把 `resolveValidationClock` 结果并入该行 `detail`（`pipeline_started_at`/`deadline_at`），deadline fence 读该 clock 判 `deadlineExceeded`。
- 既有单测 `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` **11 条当前全绿**，锁定「首个 generator 共享窗口」「持久化 clock 复用」「malformed clock fail-closed」「authoring 角色返回 null」等语义——本 sprint 的无-fix-轮回归断言必须与之一致。

**结论**：净增量 = 在 `resolveValidationClock` 的 `VALIDATION_ACTIONS` 闸之后、原「最早 generator 原点」逻辑之前，插入**有界 fix 轮顺延**分支：当 decisionLog 含 `spawn:generator-fix` 行时，原点改取「最后一次（有界第 6 次）fix 行」的 `created_at`，deadline = 该时刻 + `timeout_seconds`；无 fix 轮时**完全回落**到现有逻辑。不改 `timeout_seconds` 默认值、不动人审 deadline 分支、不动 `persistedClock` malformed 校验。

## Response Schema（推导来源: N/A — 不新增/不修改任何 HTTP 端点）

N/A — 本 sprint 仅改 orchestrator 纯函数 `resolveValidationClock`，无 HTTP 端点、无 DB 写。函数返回契约（作参考，非新增）：`{ pipeline_started_at: ISO8601 string, deadline_at: ISO8601 string }` 或 `null`（authoring 角色）或抛 `validation_clock_*` 错误。Reviewer 第 6 维（新端点 schema 完整性）对本 sprint 自动满分。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试 packages/brain/src/orchestrator/__tests__/validation-clock.test.js] → 首个 Generator intent 起一个共享窗口；下游角色（generator-fix/evaluator/judge）复用持久化 clock；无 clock 的下游角色 fail-closed（`validation_clock_required`）。
- [回归测试 同上] → pre-fix in-flight run 从首个 Generator 的 `created_at` 恢复；verified_existing_pr evaluator 可作原点；malformed 持久化 clock 抛 `validation_clock_invalid`；authoring 角色（如 spawn:reviewer）返回 `null`。
- [回归测试 tests/gp/f1/step3-seal-repo-row-behavior.test.js] → 引用 validation-clock，本 sprint 不得破坏其断言。
- [累积FR] context-manifest: unavailable（本 line 无累积 FR，PRD 段亦为空）。

## 锚定父路声明

覆盖父路 F1（工厂·开发闭环）第 3 步「造完真验」——validation clock 是 F1 step3「造完真验」阶段 pipeline deadline 判定的组成部分（冻结测试落在 `tests/gp/f1/`，与既有 `step3-*.test.js` 家族同闸）。本 sprint 为该父路 keep-green 增量（长跑 run 不被固定 deadline 误杀），不回退父路已绿行为。

## Golden Path

[一个长跑 run 进入 GAN 修复循环] → [反复派发 `spawn:generator-fix`（decisionLog 累积 fix 行）] → [`resolveValidationClock` 原点顺延到最后一次 fix，管线健康推进的 run 不再被固定 deadline 误杀] → [顺延满 6 次后原点冻结在第 6 次 fix，超限照常判死（有界）]

---

### Step 1: 长跑 run 多次 fix 轮后，clock 原点顺延到最后一次 fix（复刻 r50，旧判死→新存活）
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 1-3 步（原点取最后一次 `spawn:generator-fix`；复刻 r50 场景旧判死→新存活）

**可观测行为**: decisionLog = 首个 generator(00:00) + 3 个 `spawn:generator-fix`(01:20/02:40/04:00)，timeout=5400s。`resolveValidationClock({action:'spawn:evaluator'|'spawn:judge'|'spawn:generator-fix', ...})` 返回 `{pipeline_started_at:'…04:00', deadline_at:'…05:30'}`（原点=最后 fix，deadline 在未来 → run 存活）；旧实现返回 `…00:00 / …01:30`（过期 → 判死）。

**验证命令**:
```bash
cd /workspace && npx vitest run tests/gp/f1/step3-validation-clock-fix-round-extend.test.js --no-cache --reporter=dot
# 期望：8 passed（含 replay 顺延存活 / 下游 judge / 新 fix 派发均取最后 fix 原点）
```
**硬阈值**: `pipeline_started_at` == 最后一次 fix 的 `created_at`；`deadline_at` == 该时刻 + `timeout_seconds`（04:00+5400s=05:30）；退出码 0。

---

### Step 2: 顺延有界——满 6 次后原点冻结在第 6 次 fix，超限照常判死
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「顺延次数上限 6 次」+ 边界情况「恰好第 6 次仍顺延；第 7 次起原点冻结在第 6 次 fix」

**可观测行为**: decisionLog = generator + 7 个 fix(整点 01:00..07:00)。`resolveValidationClock` 原点冻结在第 6 次 fix(06:00)，返回 `{pipeline_started_at:'…06:00', deadline_at:'…07:30'}`；第 7 次 fix(07:00) **不**成为原点（有界）。恰好 6 次 fix 时原点=第 6 次 fix(06:00，仍顺延)。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts --no-cache --reporter=dot
# 期望：3 passed（顺延存活 / 有界满6次判死 / 无fix轮回归）
```
**硬阈值**: 7 个 fix 时 `pipeline_started_at` == 第 6 次 fix `created_at`(06:00)，**不等于**第 7 次 fix(07:00)；`deadline_at`==06:00+5400s=07:30；退出码 0。

---

### Step 3: 无 fix 轮语义完全不变（回归现状），既有单测不回归
**来源**: `[AI_ADDED]` — 理由：防止顺延分支污染无-fix-轮路径。把「无 fix 轮 = 首个 generator 原点」codify 成可执行回归断言，并强制既有 11 条 brain 单测保持全绿，堵住对抗性适应（改顺延分支时误改无-fix 路径冒充绿）。

**可观测行为**: decisionLog 无任何 `spawn:generator-fix` 行时，`resolveValidationClock` 行为与当前实现**逐字段一致**（原点=首个 generator 持久化 clock / created_at 恢复 / malformed fail-closed / authoring 返回 null）。既有 `validation-clock.test.js` 11 条全绿。

**验证命令**:
```bash
( cd /workspace/packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=dot )
# 期望：11 passed（无 fix 轮语义不变，用包内 vitest 配置，子 shell 切进包根）
```
**硬阈值**: 既有 11 条断言全过，退出码 0；不删改其任一断言。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路；`resolveValidationClock` 是 orchestrator 进程内纯函数，输入为 `orchestrator_decision_log` 行数组（进程内对象），无外部认证/无 HTTP body。

## 禁 mock 边清单

- `resolveValidationClock` ↔ `decisionLog` 行 shape（本单改的就是这条边的**原点选择逻辑**：从「最早 generator」改为「最后 fix，有界 6」）。冻结测试必须**真调** `resolveValidationClock`，传真实决策行对象（`{hop, action:'spawn:generator'|'spawn:generator-fix', created_at, detail}`），**禁** `vi.mock`/stub `resolveValidationClock` 本身或伪造其返回。
- 说明：本单为**纯函数**改动，函数内部无 DB 写路径、无跨进程调用；真实 `loop.js` ↔ `orchestrator_decision_log`（真 Postgres 读决策行 + deadline fence）集成边**不在本 sprint 范围**（见「未覆盖真实链路清单」），故不在禁 mock 边内、也不引入任何 mock。

## 未覆盖真实链路清单

- `loop.js` ↔ `orchestrator_decision_log` 真库集成（真 Postgres 读 fix 行 + deadline fence 真判 `automation_deadline_exceeded`） | 本 sprint 范围仅纯函数，postgres=false 无真库；PRD「不改真库 loop.js 集成接缝」明确出范围 | 补位：登记为后续 sprint 的真库集成接缝，本轮不补位（按 PRD 范围外登记）。
- 生产 run 端到端「长跑 run 撞 deadline 被顺延存活」真链路 | 需真 orchestrator 跑真 GAN 循环 + 真 DB，超出纯函数 sprint | 补位：纯函数层由本轮冻结测试穷举（replay/有界/乱序/回归）；真链路留待集成 sprint。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统承诺 | `resolveValidationClock` 在 decisionLog 含 `spawn:generator-fix` 时，pipeline clock 原点顺延到最后一次（有界第 6 次）fix 行 created_at；无 fix 轮时语义不变 |
| **NFR** | 性能/可靠性 | 纯函数、无 I/O、无时钟旁路、可重放；`timeout_seconds` 默认 5400s 不变；顺延上限 6 次（有界） |
| **Invariant** | 永不违反 | 不改 `timeout_seconds` 默认值；不动人审 deadline（`WAIT_HUMAN_REVIEW`/`review_head_sha`/`allowEvaluatorOrigin`）；不破坏 `persistedClock` malformed→`validation_clock_invalid` 断言；既有 11 条 brain 单测不回归 |
| **判定点** | 模糊现实判断 | 见判定点登记表 |
| **保质期** | 何时过期 | 顺延上限 6 次为硬编码常量，无独立保质期；决策行时序来自 `orchestrator_decision_log`，随 run 生命周期 |
| **死亡告警** | 停了谁知道 | 顺延逻辑错误由冻结测试（gp/f1 + sprint）+ 既有 brain 单测在 CI/evaluator 阶段拦截；生产误杀由 run failure_class=automation_deadline_exceeded 可观测 |
| **失败语义** | 挂了怎么办 | 见失败语义声明 |
| **效果确认** | 已发≠已生效 | 冻结测试断言函数返回值 `deadline_at` == 顺延后时刻（非旧原点）；退出码 0 为真绿，assertion 失败传播非 0 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 一次 fix 轮的「顺延原点时刻」取哪一列 | A. fix 行 `created_at`; B. fix 行 `detail.pipeline_started_at`(持久化, 指向上一轮原点) | A（fix 行 `created_at`） | PRD 明确「deadline = 该 fix 行时间 + timeout」；持久化 detail 指向更早原点会自我抵消不顺延 | 误取 B → 顺延失效，长跑 run 仍被误杀（面客：run 假死，人工 psql 续命回潮） |
| 「fix 轮数」如何计数（乱序/重复 hop） | A. 按 hop 升序取 `spawn:generator-fix` 行序列; B. 按数组出现顺序 | A（hop 升序） | PRD「以 hop 时序为唯一输入，纯函数可重放」；数组顺序不稳定 | 误取 B → 同输入不同数组顺序结果漂移，不可重放 |
| 顺延边界（第 7 次 fix 是否仍顺延） | A. `min(count,6)` 号 fix 为原点; B. 无界一路顺延 | A（有界 6） | PRD 明确上限 6，超限照常判死 | 误取 B → 坏 run 永不判死，占用算力槽 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写库 | 是（task_id 幂等） | 客户端重试 |
| decisionLog 含 fix 行但 fix 行 `created_at` 非法/缺失 | `exactClock` 抛 `validation_clock_invalid`（fail-closed，沿用既有语义） | 是（纯函数，同输入同结果） | 不静默兜底，抛错交上游 |
| 无 fix 轮且下游角色无 generator clock | 抛 `validation_clock_required`（既有 fail-closed，不变） | 是 | 沿用现状 |
| 顺延后仍超 deadline（有界满 6 次） | 返回过期 clock → loop 判 `automation_deadline_exceeded`（有界，符合预期） | 是 | 照常判死（PRD 要求的有界行为） |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent/爬虫入库/外部可写接口；`resolveValidationClock` 输入为 orchestrator 进程内可信决策行，非外部不可信输入。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数低接缝风险）
高风险面:
- 错输入: decisionLog 传 `spawn:generator-fix` 行但 `created_at` 为 `null`/`'not-a-time'`/缺失 → 应 fail-closed 抛 `validation_clock_invalid`，不返回 NaN deadline
- 重复提交: 同一 hop 出现多个 `spawn:generator-fix` 行（重复）→ hop 升序去重后取最后合法 fix，结果可重放
- 中途中断: decisionLog 只有 fix 行无 generator 行（异常时序）→ 仍以最后 fix 为原点，不崩溃
- 边界值: 恰好 6 / 恰好 7 个 fix 行的原点分界；fix 行与 verified_existing_pr evaluator 原点并存时 fix 顺延优先
发现分级: P0/P1（顺延失效致长跑 run 误杀 / 无界致坏 run 永不判死 / 无 fix 轮语义回退）→ 阻塞 merge；P2/P3（错误信息文案）→ 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api（纯函数 sprint，postgres=false：验收=真跑冻结测试真 import 被改文件，无需 DB/Brain server；evaluator 独立 task 执行本段）

> 说明：本 sprint 改的是 orchestrator 进程内纯函数 `resolveValidationClock`，无 HTTP 端点、无 DB 写。故 local_api 验收不起 Brain server / 不连 Postgres（runtime postgres=false），而是从仓库根真跑两份冻结测试（真 import `packages/brain/src/orchestrator/validation-clock.js`，真断言函数返回值），并跑既有 brain 单测作无-fix-轮回归守卫。单个 bash 块，按序拼接执行。
> vitest 工作目录：`tests/**`、`sprints/**` 冻结测试从仓库根跑（root vitest include 覆盖）；`packages/brain/src/**` 既有单测用子 shell 切进包根（9.25 死规则，用包内 vitest 配置）。

```bash
set -euo pipefail
cd /workspace

# 1. F1 gp/f1 冻结测试：fix 轮顺延存活 + 有界满6判死 + 乱序可重放 + 无fix回归（真 import validation-clock.js）
npx vitest run tests/gp/f1/step3-validation-clock-fix-round-extend.test.js --no-cache --reporter=dot

# 2. sprint 冻结合同测试（seal gate 认这一份）：replay 顺延 / 有界 / 无fix回归
npx vitest run sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts --no-cache --reporter=dot

# 3. 回归守卫：既有 brain 单测（无 fix 轮语义不变，11 条不回归）——子 shell 切进包根用包内 vitest 配置
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=dot )

echo "OK: validation clock fix-round extension golden path verified"
```

**通过标准**: 三段 vitest 全绿（gp/f1 8 passed + sprint 3 passed + brain 单测 11 passed），脚本 exit 0；顺延后 `deadline_at` 为最后 fix 时刻 + timeout（非旧 generator 原点），有界满 6 次冻结在第 6 次 fix。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| validation clock 按 fix 轮顺延（有界） | `sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts` | `复刻r50场景 多次fix后新原点顺延存活`、`顺延有界 满6次后第7次不再顺延照常判死`、`无fix轮语义不变` | → 2 failures（新行为断言红，无fix回归绿；见 red-evidence.md） |

> **冻结测试 = `sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts`**（本轮落盘并进 commit；封印闸 `assertTestContractResolvable` 用 `resolveContractTestFile` 校验此列，已核实可解析）。
> BEHAVIOR 覆盖名均为对应 `it()` 名的**字面连续子串**，且不含 `/ , 、 ; ；` 分隔符——已按封印闸解析链核实每 token 命中真实 `it()`。
> **补充行（不入本表，PRD 要求的 F1 gp-anchor 闸产物）**：`tests/gp/f1/step3-validation-clock-fix-round-extend.test.js`（真 import 同一被改文件 `validation-clock.js`，8 条穷举 replay/下游/有界/边界/乱序/回归）。不入本表的原因：覆盖检查器 `resolveContractTestFile` 把本表 Test File 列按「相对 sprint 目录」解析（候选 `sprints/<dir>/tests/gp/f1/...` 不存在 → 解析 null），列进去反而误报「文件不存在」；该测试由 F1 gp-anchor CI 闸（跑 `tests/gp/f1/**`）实跑守护，与本 sprint 冻结测试双闸互补。
