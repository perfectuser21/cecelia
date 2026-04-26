# Sprint Contract Draft (Round 2)

> 对应 PRD：`sprints/sprint-prd.md` — Brain Orchestrator v2 P2 收尾：Spawn Policy Layer 接线
> Planner branch：`cp-04261059-harness-prd`
> Propose round：2
> Generator：harness-contract-proposer
> 上轮反馈处理：见 `## Round 2 Revision Notes`

---

## Round 2 Revision Notes

针对 Round 1 Reviewer 指出的两类问题，本轮做了以下结构性调整：

### A. "0 次触发" 语义澄清（Reviewer 反馈①）

Reviewer 指出 Round 1 对 `SPAWN_V2_ENABLED=false` 分支"0 次触发"的描述含混 — 旧 `executeInDocker` 路径在 `docker-executor.js` 内部本就会调一些与 middleware 同名的内部 helper（例如 docker-executor.js 内的 `resolveResourceTier`、内部资源 tier 解析等），这些不是 spawn/middleware/ 下的模块函数，不应该被算作"middleware 触发"。

**澄清后的语义（落到测试与硬阈值）**：

> "0 次触发"= **`spawn.js` 顶部 `import` 出来的 `spawn/middleware/*` 模块函数被调用次数为 0**。旧 `executeInDocker` 内部使用的 `docker-executor.js` 自带 helper（同名或不同名）一律不计；`classifyFailure` / `shouldRetry` 来自 `spawn/middleware/retry-circuit.js`，但它们是 spawn-level 循环判定职责，不属于"接线 middleware"，故 V2-disabled 时仍允许调用。

WS1 测试通过 `vi.mock('../../../packages/brain/src/spawn/middleware/*.js')` 路径注入打桩 — 当 V2-disabled 直接走 `executeInDocker`（也被 mock）时，spawn/middleware/* 路径下的 mock 自然 0 触发；而 docker-executor.js 内部任何同名 helper 调用都不会进入这些 mock，因此不会污染计数。

### B. Risks 栏目补全（Reviewer 反馈②：risk_registered=3 → ≥ 7）

Round 1 未单列 Risks 栏目，Reviewer 要求至少 3 条带 mitigation 的风险登记，本轮补充至 **7 条**（覆盖 cascade 顺序、V2 回滚副作用、billing 一致性、env 删除契约、cost-cap 阻断、并发账号 race、grep guard 误判）。详见下方 `## Risks Register`。

---

## Feature 1: Spawn 洋葱链装配 + V2 开关

**行为描述**：

Brain 的唯一 Docker 执行原语 `spawn(opts)` 必须在每次调用时按确定顺序经过两层洋葱：外层 Koa 风格 4 个 middleware（cost-cap → spawn-pre → logging → billing），内层 attempt-loop 显式 6 步（account-rotation → cascade → resource-tier → docker-run → cap-marking → retry-circuit），最多 3 次 attempt。

新增 `SPAWN_V2_ENABLED` 环境变量作为回滚开关：默认 `true` 走真洋葱链；显式置 `false` 时绕过 `spawn/middleware/*` 装配，直接退化为 PR 之前的 `for` 循环 + `executeInDocker`，行为与本 Initiative 之前完全一致。**回滚路径必须保留旧 `markSpendingCap` 副作用**（见 R2 mitigation）。

**硬阈值**：

- 当 `SPAWN_V2_ENABLED !== 'false'` 时，单次成功 `spawn()` 必须至少触发：1 次 `checkCostCap`、1 次 `preparePromptAndCidfile`、1 次 `createSpawnLogger().logStart`、1 次 `createSpawnLogger().logEnd`、1 次 `recordBilling`、1 次 `resolveAccount`、1 次 `resolveCascade`、1 次 `resolveResourceTier`、1 次 `runDocker`、1 次 `checkCap`、1 次 `classifyFailure`
- 当 `SPAWN_V2_ENABLED === 'false'` 时，**`spawn.js` 顶部 import 自 `spawn/middleware/*` 的模块函数**调用次数为 0；但是 `spawn/middleware/cap-marking.js` 同源 OR 旧 `markSpendingCap`（来自 `account-usage.js`）必须在 docker-executor 返回 429 时被调用 ≥ 1 次（保护 R2 副作用不丢）
- 任意路径下 `spawn()` 都 **不主动 delete** `opts.env.CECELIA_CREDENTIALS`（spec 契约，对应 R4）
- attempt 0 docker-run 命中 429 → cap-marking 必须标记当前 `opts.env.CECELIA_CREDENTIALS` 为 capped；attempt 1 的 account-rotation 必须读 `isSpendingCapped` 并自动换到另一个未 cap 账号
- 当 sonnet 三个账号全部 cap 之前，cascade middleware 必须**至少在 ≥ 3 次 attempt 中保持 model 是 sonnet 家族**（横切账号），任何单一账号 cap 时立刻就降模型一律视为违约
- billing middleware 写入 `dispatched_account` 的字段集合必须与 `executor.js:3066-3067` 现有 `pool.query` 写入字段一致（key 集合 byte-equal，详见 R3 mitigation）

**BEHAVIOR 覆盖**（落到 `tests/ws1/spawn-onion.test.ts`）：

- `it('SPAWN_V2_ENABLED unset (default true): runs full onion chain — outer 4 + inner 6 middleware all invoked once on success')`
- `it('SPAWN_V2_ENABLED=false: bypasses spawn/middleware/* — outer/inner middleware mock invocation count is 0, executeInDocker is called directly')`
- `it('V2 disabled: legacy path still marks spending cap on 429 — markSpendingCap (or cap-marking) invoked at least once when executeInDocker returns api_error_status:429')` ← **R2 回归护栏**
- `it('account capped fallback: account1 marked capped → account-rotation selects account2/3, billing records the actually-used account')`
- `it('cascade preserves sonnet across accounts: at least 3 attempts keep model in sonnet family before any opus/haiku/minimax downgrade is allowed')` ← **R1 mitigation**
- `it('429 transient retry: attempt 0 returns api_error_status:429 → cap-marking marks account, attempt 1 account-rotation switches account, no opts.env.CECELIA_CREDENTIALS delete by spawn itself')`
- `it('cost-cap blocks spawn: when getBudget reports usage_usd >= usd, spawn rejects with CostCapExceededError before any docker call')`
- `it('SPAWN_V2_ENABLED=true preserves attempt-loop semantics: transient × 3 still gives up after MAX_ATTEMPTS=3')`
- `it('billing payload contains exactly the legacy field set: dispatched_account + dispatched_model (key set byte-equal with executor.js legacy UPDATE)')` ← **R3 mitigation**

**ARTIFACT 覆盖**（落到 `contract-dod-ws1.md`）：

- `spawn.js` 必须 import 全部 10 个 middleware 模块
- `spawn.js` 必须存在 `SPAWN_V2_ENABLED` 字符串引用
- `spawn.js` V2-disabled 分支必须保留 `markSpendingCap` 调用（来自 `account-usage` 或 `cap-marking`），不能裸 return executeInDocker 结果
- `spawn/__tests__/spawn.test.js` 必须扩展到 ≥ 10 个 `it()` 块
- `spawn/README.md` 必须含 "P2 接线完成" 字样

---

## Feature 2: 4 个 Caller 迁移到 spawn() + 内联逻辑下沉

**行为描述**：

Brain 内所有要在 Docker 容器里跑 Claude 会话的入口都收敛到 `spawn(opts)`：`executor.js` 的 `HARNESS_DOCKER_ENABLED=true` 分支、`harness-graph-runner.js` 的默认 `dockerExecutor`、`workflows/content-pipeline-runner.js` 的默认 `dockerExecutor` 三处不再直接 import `executeInDocker`，而是 import `spawn` 作为 Docker 执行入口。

`executor.js` 行 3037-3078 之间的"固定账号 cap 检测 + selectBestAccount 兜底 + 写 dispatched_account 到 task payload"内联逻辑必须删除，由 spawn 内部 account-rotation + billing middleware 接管。**billing middleware 写入 `dispatched_account` 时使用的字段集合必须与 `executor.js:3066-3067` 旧 SQL 写入字段一致**（R3 cross-check）。

测试注入接口（`opts.dockerExecutor` 在 graph-runner / content-pipeline-runner 上）必须保留 — caller 不传时默认 spawn，传 mock 时仍生效。

**硬阈值**：

- `packages/brain/src/executor.js` 中 `isSpendingCapped` 与 `selectBestAccount` 的直接调用次数：**0**
- `packages/brain/src/executor.js` 中 `executeInDocker(` 直接函数调用次数：**0**
- `grep -rn "from.*docker-executor" packages/brain/src/` 排除 `__tests__/` 与 `spawn/` 后必须输出 **0** 行（仅 `harness-task-dispatch.js` 的 `writeDockerCallback` 是允许例外，但目前它从同一文件导入 → 必须搬到独立模块或在该文件内 inline export）
- `packages/brain/src/harness-graph-runner.js` 与 `packages/brain/src/workflows/content-pipeline-runner.js` 必须 import `spawn`（不是 `executeInDocker`）作为默认 `dockerExecutor`
- 测试传入 `opts.dockerExecutor=mockFn` 时，graph-runner 与 content-pipeline-runner 内部节点最终接收到的 executor 必须是 `mockFn` 而非 `spawn`
- `billing.js` 写入 task payload 的 key 集合必须 ⊇ `{dispatched_account, dispatched_model}`（与 `executor.js:3066` 旧 SQL UPDATE 的字段集合 byte-equal 子集），WS2 测试静态断言双侧字段一致

**BEHAVIOR 覆盖**（落到 `tests/ws2/caller-migration.test.ts`）：

- `it('executor.js no longer imports isSpendingCapped or selectBestAccount from account-usage')`
- `it('executor.js no longer imports executeInDocker from docker-executor')`
- `it('executor.js HARNESS_DOCKER_ENABLED branch invokes spawn(), not executeInDocker, when triggered')`
- `it('executor.js HARNESS_DOCKER_ENABLED branch no longer contains inline isSpendingCapped or selectBestAccount calls')`
- `it('harness-graph-runner default dockerExecutor is spawn, not executeInDocker')`
- `it('content-pipeline-runner default dockerExecutor is spawn, not executeInDocker')`
- `it('opts.dockerExecutor injection still overrides the spawn default in both runners')`
- `it('grep guard: no business file under packages/brain/src/ (excluding spawn/ and __tests__/) imports executeInDocker')`
- `it('billing dispatched_account field-set cross-check: billing.js payload keys ⊇ {dispatched_account, dispatched_model} matching executor.js legacy UPDATE field set')` ← **R3 mitigation**

**ARTIFACT 覆盖**（落到 `contract-dod-ws2.md`）：

- `executor.js` import 行不含 `selectBestAccount` 与 `isSpendingCapped`
- `executor.js` import 行不含 `executeInDocker`（`writeDockerCallback` / `resolveResourceTier` / `isDockerAvailable` 这三个非 executeInDocker 的 export 允许保留）
- `harness-graph-runner.js` import 行含 `spawn`
- `content-pipeline-runner.js` import 行含 `spawn`
- `executor.js` 中行号区间 [3030, 3080) 不再含 `isSpendingCapped(` / `selectBestAccount(` 字符串
- `billing.js` 源码必须含 `dispatched_account` 与 `dispatched_model` 两个 key，使其与 executor.js 旧 UPDATE 字段集合一致

---

## Risks Register

| ID | Risk | Severity | Mitigation | 覆盖测试/Artifact |
|---|---|---|---|---|
| R1 | cascade middleware 顺序错误导致 sonnet→opus 提前降级 — 任何单一 sonnet 账号 cap 立刻降模型违反 spec §5.3 | High | WS1 P0 守卫测试 `cascade preserves sonnet across accounts` 阈值检查 sonnet 横切尝试次数 ≥ 3；任何 attempt 用非 sonnet 模型则失败 | `tests/ws1/spawn-onion.test.ts` it #5 |
| R2 | `SPAWN_V2_ENABLED=false` 走旧路径时 cap-marking 副作用丢失（429 命中后账号未被标 capped → 死循环派发） | High | V2-disabled 分支必须仍调用 `markSpendingCap`（来自 account-usage 或 cap-marking 同源）；新增回归护栏测试 | `tests/ws1/spawn-onion.test.ts` it #3；`contract-dod-ws1.md` ARTIFACT 条目 #4 |
| R3 | billing middleware 写 `dispatched_account` 与 executor.js 现有 `pool.query UPDATE tasks SET payload \|\| dispatched_account` 字段漂移（漏字段或多字段污染下游回调） | High | billing middleware 写入字段集合必须 ⊇ `{dispatched_account, dispatched_model}`；WS2 cross-check 静态断言 billing.js 源码与 executor.js:3066 SQL 字段对齐 | `tests/ws2/caller-migration.test.ts` it #9；`tests/ws1/spawn-onion.test.ts` it #9 |
| R4 | spawn 主动 `delete opts.env.CECELIA_CREDENTIALS` 破坏 spec 契约（caller 期望复用 env 复式调用） | Medium | 硬阈值: spawn 实现严禁 delete env 字段；429 retry 测试断言 `opts.env.CECELIA_CREDENTIALS` + 其他 env 字段在 spawn 返回后均保持原值 | `tests/ws1/spawn-onion.test.ts` it #6 |
| R5 | cost-cap middleware 实现成"软警告"而非"硬阻断" — 即使预算超限仍触发 docker-run 浪费配额 | Medium | cost-cap 测试断言：超限时 spawn 抛 CostCapExceededError，且 mockRunDocker 调用次数 = 0、mockExecuteInDocker 调用次数 = 0 | `tests/ws1/spawn-onion.test.ts` it #7 |
| R6 | 测试注入 `opts.dockerExecutor=mockFn` 在 graph-runner / pipeline-runner 中被 spawn 默认值"短路覆盖"（破坏老测试套件） | Medium | WS2 静态正则断言 `const executor = opts.dockerExecutor \|\| spawn` 模式被严格保留 | `tests/ws2/caller-migration.test.ts` it #7；`contract-dod-ws2.md` ARTIFACT #6/#7 |
| R7 | grep guard 误判 — `harness-task-dispatch.js` 仅 import `writeDockerCallback`（非 executeInDocker）被 grep 命中导致回归误报 | Low | grep guard 命令链增加 `xargs grep -l "\\bexecuteInDocker\\b"` 二次过滤，仅命中真正 import executeInDocker 的文件；`docker-executor.js` 自身被排除 | `tests/ws2/caller-migration.test.ts` it #8；`contract-dod-ws2.md` ARTIFACT #8 |

**risk_registered**: 7（满足 Reviewer ≥ 7 目标）

---

## Workstreams

workstream_count: 2

### Workstream 1: Spawn Onion Chain Assembly + V2 开关

**范围**：
- `packages/brain/src/spawn/spawn.js`：从 46 行的占位 attempt-loop 升级为 ~200 行的真两层洋葱链
- 装配 10 个 middleware（外层 Koa next() 风格 4 个 + 内层 attempt-loop 显式 6 个）
- 新增 `SPAWN_V2_ENABLED` env 读取与 false 分支退化路径，**保留 markSpendingCap 副作用**
- 更新 `packages/brain/src/spawn/README.md` 状态行
- 测试位于 `packages/brain/src/spawn/__tests__/spawn.test.js`，扩展 ≥ 3 个 E2E 场景

**大小**：M（spawn.js 约 +180 行；测试约 +250 行；README 1 行）

**依赖**：无（10 个 middleware 单元已在 PR #2543-#2555 落地，本 WS 只装配）

**BEHAVIOR 覆盖测试文件**：`sprints/tests/ws1/spawn-onion.test.ts`

### Workstream 2: Caller Migration + Inline Logic Extraction

**范围**：
- `packages/brain/src/executor.js`：HARNESS_DOCKER_ENABLED 分支替换为 `spawn()`；删除 3037-3078 内联 cap/selectBestAccount 调用；`import` 行替换 `executeInDocker` 为 `spawn`
- `packages/brain/src/harness-graph-runner.js`：`dockerExecutor` 默认值改 `spawn`，import 改为 `import { spawn } from './spawn/index.js'`
- `packages/brain/src/workflows/content-pipeline-runner.js`：同上
- 保留 `opts.dockerExecutor` 测试注入接口
- billing.js 字段集合 cross-check（与 executor.js 旧 SQL 字段对齐）

**大小**：M（executor.js 删除 ~50 行 + 替换 ~10 行；其它 2 文件 import + 默认值改动各 ~3 行）

**依赖**：WS1（spawn() 必须先有真实 middleware 装配；但 WS2 的测试中可以 mock spawn 解耦验证 caller 接线）

**BEHAVIOR 覆盖测试文件**：`sprints/tests/ws2/caller-migration.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/spawn-onion.test.ts` | onion-chain-full / V2-disabled-bypass-spec / V2-disabled-still-marks-cap (R2) / capped-account-fallback / cascade-sonnet-≥3-attempts (R1) / 429-retry-no-env-delete (R4) / cost-cap-rejects (R5) / max-attempts-boundary / billing-field-set (R3) | 实测 9 个 it 中 ≥ 7 fail：除 `SPAWN_V2_ENABLED=false bypass` 之外其余在当前占位 spawn.js 上失败（V2-disabled-bypass-spec 因当前 spawn.js 直走 executeInDocker，恰好 PASS — 该测试是回归护栏，防 V2 装配后回滚开关失效） |
| WS2 | `sprints/tests/ws2/caller-migration.test.ts` | executor-no-account-usage-import / executor-no-executeInDocker-import / executor-invokes-spawn / executor-no-inline-cap-calls / graph-runner-default-spawn / content-pipeline-default-spawn / dockerExecutor-injection-still-works / grep-guard-no-stray-import / billing-field-set-cross-check (R3) | 实测 9 个 it 全 fail（executor.js 仍 import + 直接调 executeInDocker / selectBestAccount；harness-graph-runner / content-pipeline-runner 默认仍是 executeInDocker） |

**Round 2 Red Evidence**：本地 `cd /workspace && node_modules/.bin/vitest run --config sprints/tests/vitest.config.ts` 预期 → `Tests ≥ 16 failed | ≤ 2 passed (18)`。详细 Red log 见 push 前本地跑测覆盖（Step 2d）。

