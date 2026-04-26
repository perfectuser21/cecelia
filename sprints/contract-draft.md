# Sprint Contract Draft (Round 1)

> 对应 PRD：`sprints/sprint-prd.md` — Brain Orchestrator v2 P2 收尾：Spawn Policy Layer 接线
> Planner branch：`cp-04261059-harness-prd`
> Propose round：1
> Generator：harness-contract-proposer

---

## Feature 1: Spawn 洋葱链装配 + V2 开关

**行为描述**：

Brain 的唯一 Docker 执行原语 `spawn(opts)` 必须在每次调用时按确定顺序经过两层洋葱：外层 Koa 风格 4 个 middleware（cost-cap → spawn-pre → logging → billing），内层 attempt-loop 显式 6 步（account-rotation → cascade → resource-tier → docker-run → cap-marking → retry-circuit），最多 3 次 attempt。

新增 `SPAWN_V2_ENABLED` 环境变量作为回滚开关：默认 `true` 走真洋葱链；显式置 `false` 时绕过所有 middleware，直接退化为 PR 之前的 `for` 循环 + `executeInDocker`，行为与本 Initiative 之前完全一致。

**硬阈值**：

- 当 `SPAWN_V2_ENABLED !== 'false'` 时，单次成功 `spawn()` 必须至少触发：1 次 `checkCostCap`、1 次 `preparePromptAndCidfile`、1 次 `createSpawnLogger().logStart`、1 次 `createSpawnLogger().logEnd`、1 次 `recordBilling`、1 次 `resolveAccount`、1 次 `resolveCascade`、1 次 `resolveResourceTier`、1 次 `runDocker`、1 次 `checkCap`、1 次 `classifyFailure`
- 当 `SPAWN_V2_ENABLED === 'false'` 时，单次 `spawn()` 必须 **0 次** 触发以上 middleware（除 `classifyFailure` / `shouldRetry` 仍允许保留旧 attempt-loop 的判定职责）
- 任意路径下 `spawn()` 都 **不主动 delete** `opts.env.CECELIA_CREDENTIALS`（spec 契约）
- attempt 0 docker-run 命中 429 → cap-marking 必须标记当前 `opts.env.CECELIA_CREDENTIALS` 为 capped；attempt 1 的 account-rotation 必须读 `isSpendingCapped` 并自动换到另一个未 cap 账号
- 当 sonnet 三个账号全部 cap，cascade middleware 必须按 spec §5.3 顺序：先横切账号保 sonnet → 全满才降到 opus → 再 haiku → 最后 minimax，**禁止**在任何单一账号 cap 时就立刻降模型

**BEHAVIOR 覆盖**（落到 `tests/ws1/spawn-onion.test.ts`）：

- `it('SPAWN_V2_ENABLED unset (default true): runs full onion chain — outer 4 + inner 6 middleware all invoked once on success')`
- `it('SPAWN_V2_ENABLED=false: bypasses all middleware, calls executeInDocker directly — outer/inner middleware invocation count is 0')`
- `it('account capped fallback: account1 marked capped → account-rotation selects account2/3, billing records the actually-used account')`
- `it('cascade preserves sonnet across accounts: account1 sonnet capped does NOT trigger model downgrade — cascade still tries account2/3 sonnet first')`
- `it('429 transient retry: attempt 0 returns api_error_status:429 → cap-marking marks account, attempt 1 account-rotation switches account, no opts.env.CECELIA_CREDENTIALS delete by spawn itself')`
- `it('cost-cap blocks spawn: when getBudget reports usage_usd >= usd, spawn rejects with CostCapExceededError before any docker call')`
- `it('SPAWN_V2_ENABLED=true preserves attempt-loop semantics: transient × 3 still gives up after MAX_ATTEMPTS=3')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws1.md`）：

- `spawn.js` 必须 import 全部 10 个 middleware 模块
- `spawn.js` 必须存在 `SPAWN_V2_ENABLED` 字符串引用（环境变量读取或导出常量）
- `spawn/__tests__/spawn.test.js` 必须扩展到 ≥ 10 个 `it()` 块
- `spawn/README.md` 必须含 "P2 接线完成" 字样

---

## Feature 2: 4 个 Caller 迁移到 spawn() + 内联逻辑下沉

**行为描述**：

Brain 内所有要在 Docker 容器里跑 Claude 会话的入口都收敛到 `spawn(opts)`：`executor.js` 的 `HARNESS_DOCKER_ENABLED=true` 分支、`harness-graph-runner.js` 的默认 `dockerExecutor`、`workflows/content-pipeline-runner.js` 的默认 `dockerExecutor` 三处不再直接 import `executeInDocker`，而是 import `spawn` 作为 Docker 执行入口。

`executor.js` 行 3037-3078 之间的"固定账号 cap 检测 + selectBestAccount 兜底 + 写 dispatched_account 到 task payload"内联逻辑必须删除，由 spawn 内部 account-rotation + billing middleware 接管。

测试注入接口（`opts.dockerExecutor` 在 graph-runner / content-pipeline-runner 上）必须保留——caller 不传时默认 spawn，传 mock 时仍生效。

**硬阈值**：

- `packages/brain/src/executor.js` 中 `isSpendingCapped` 与 `selectBestAccount` 的直接调用次数：**0**
- `packages/brain/src/executor.js` 中 `executeInDocker(` 直接函数调用次数：**0**
- `grep -rn "from.*docker-executor" packages/brain/src/` 排除 `__tests__/` 与 `spawn/` 后必须输出 **0** 行（仅 `harness-task-dispatch.js` 的 `writeDockerCallback` 是允许例外，但目前它从同一文件导入 → 必须搬到独立模块或在该文件内 inline export）
- `packages/brain/src/harness-graph-runner.js` 与 `packages/brain/src/workflows/content-pipeline-runner.js` 必须 import `spawn`（不是 `executeInDocker`）作为默认 `dockerExecutor`
- 测试传入 `opts.dockerExecutor=mockFn` 时，graph-runner 与 content-pipeline-runner 内部节点最终接收到的 executor 必须是 `mockFn` 而非 `spawn`

**BEHAVIOR 覆盖**（落到 `tests/ws2/caller-migration.test.ts`）：

- `it('executor.js no longer imports isSpendingCapped or selectBestAccount from account-usage')`
- `it('executor.js no longer imports executeInDocker from docker-executor')`
- `it('executor.js HARNESS_DOCKER_ENABLED branch invokes spawn(), not executeInDocker, when triggered')`
- `it('harness-graph-runner default dockerExecutor is spawn, not executeInDocker')`
- `it('content-pipeline-runner default dockerExecutor is spawn, not executeInDocker')`
- `it('opts.dockerExecutor injection still overrides the spawn default in both runners')`
- `it('grep guard: no business file under packages/brain/src/ (excluding spawn/ and __tests__/) imports executeInDocker')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws2.md`）：

- `executor.js` import 行不含 `selectBestAccount` 与 `isSpendingCapped`
- `executor.js` import 行不含 `executeInDocker`（`writeDockerCallback` / `resolveResourceTier` / `isDockerAvailable` 这三个非 executeInDocker 的 export 允许保留）
- `harness-graph-runner.js` import 行含 `spawn`
- `content-pipeline-runner.js` import 行含 `spawn`
- `executor.js` 中行号区间 [3030, 3080) 不再含 `isSpendingCapped(` / `selectBestAccount(` 字符串

---

## Workstreams

workstream_count: 2

### Workstream 1: Spawn Onion Chain Assembly + V2 开关

**范围**：
- `packages/brain/src/spawn/spawn.js`：从 46 行的占位 attempt-loop 升级为 ~200 行的真两层洋葱链
- 装配 10 个 middleware（外层 Koa next() 风格 4 个 + 内层 attempt-loop 显式 6 个）
- 新增 `SPAWN_V2_ENABLED` env 读取与 false 分支退化路径
- 更新 `packages/brain/src/spawn/README.md` 状态行
- 测试位于 `packages/brain/src/spawn/__tests__/spawn.test.js`，扩展 ≥ 3 个 E2E 场景

**大小**：M（spawn.js 约 +160 行；测试约 +200 行；README 1 行）

**依赖**：无（10 个 middleware 单元已在 PR #2543-#2555 落地，本 WS 只装配）

**BEHAVIOR 覆盖测试文件**：`sprints/tests/ws1/spawn-onion.test.ts`

### Workstream 2: Caller Migration + Inline Logic Extraction

**范围**：
- `packages/brain/src/executor.js`：HARNESS_DOCKER_ENABLED 分支替换为 `spawn()`；删除 3037-3078 内联 cap/selectBestAccount 调用；`import` 行替换 `executeInDocker` 为 `spawn`
- `packages/brain/src/harness-graph-runner.js`：`dockerExecutor` 默认值改 `spawn`，import 改为 `import { spawn } from './spawn/index.js'`
- `packages/brain/src/workflows/content-pipeline-runner.js`：同上
- 保留 `opts.dockerExecutor` 测试注入接口

**大小**：M（executor.js 删除 ~50 行 + 替换 ~10 行；其它 2 文件 import + 默认值改动各 ~3 行）

**依赖**：WS1（spawn() 必须先有真实 middleware 装配；但 WS2 的测试中可以 mock spawn 解耦验证 caller 接线）

**BEHAVIOR 覆盖测试文件**：`sprints/tests/ws2/caller-migration.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/spawn-onion.test.ts` | onion-chain-full / V2-disabled-bypass / capped-account-fallback / cascade-preserves-model / 429-retry-no-env-delete / cost-cap-rejects / max-attempts-boundary | 实测 7 个 it 中 6 fail / 1 pass：除 `SPAWN_V2_ENABLED=false bypass` 之外 6 个测试在当前占位 spawn.js 上失败（SPAWN_V2_ENABLED=false 本就走旧路径所以恰好 PASS — 该测试是回归护栏，防 V2 装配后回滚开关失效） |
| WS2 | `sprints/tests/ws2/caller-migration.test.ts` | executor-no-account-usage-import / executor-no-executeInDocker-import / executor-invokes-spawn / executor-no-inline-cap-calls / graph-runner-default-spawn / content-pipeline-default-spawn / dockerExecutor-injection-still-works / grep-guard-no-stray-import | 实测 8 个 it 全 fail（executor.js 仍 import + 直接调 executeInDocker / selectBestAccount；harness-graph-runner / content-pipeline-runner 默认仍是 executeInDocker） |

**Round 1 Red Evidence**：本地 `cd /workspace && node_modules/.bin/vitest run --config sprints/tests/vitest.config.ts` → `Tests 14 failed | 1 passed (15)`。1 pass 是 V2-disabled-bypass 回归护栏，不算漏。

