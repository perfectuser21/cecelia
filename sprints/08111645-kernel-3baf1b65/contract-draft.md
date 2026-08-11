# Sprint Contract Draft (Round 1)

> Sprint: cap 修复补漏 — 迁移扩 `failure_class` 约束纳入 `account_exhausted` + 代码↔schema 奇偶回归测试
> INITIATIVE_ID: `intent:11172ed5-c4d8-418c-8711-5196f290bab5:4`
> journey_type: **autonomous** ｜ target_environment: **local_api**（Brain 后端 + PostgreSQL 约束，无 HTTP 面）

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 Kernel Harness 内部生命周期修复（配额耗尽回调恢复），无 product-map Golden Path 父路依赖。

## 现状核对（round 1 必读，Reviewer 请一并核对）

⚠️ **base_sha `f8dd23bd5` 已经包含本 PRD 绝大部分交付物**（由 hotfix PR #4798 `2a98c02ba fix(kernel): allow account exhaustion callback recovery` 先行落地）：

| PRD 要求 | base_sha 现状 | 是否已满足 |
|---|---|---|
| 迁移扩 `harness_attempts_failure_class_check` 纳入 `account_exhausted`（保留 NULL + 4 旧值） | `packages/brain/migrations/406_harness_attempt_account_exhausted.sql` 已存在（DROP IF EXISTS + ADD，幂等） | ✅ 已存在 |
| 复现 failing test（迁移前红/后绿） | `src/__tests__/integration/migration-406-account-exhausted.integration.test.js`（真 PG，含 "reproduces the production callback check violation before migration 406"） | ✅ 已存在 |
| selfcheck `EXPECTED_SCHEMA_VERSION` 同步 | `src/selfcheck.js` = `'406'`，与最大迁移号 406 一致 | ✅ 已同步 |
| 代码↔schema **奇偶校验**回归测试（枚举 execution-contract.js zod `failure_class` 全集，逐一断言 DB 约束接受，防未来脱钩） | **不存在** —— 现有测试只硬编码断言 `account_exhausted` 单值与 4 旧值文本，**没有任何测试 import zod enum 作为 SSOT 遍历断言 DB 约束** | ❌ **本 sprint 唯一净新增交付物** |

**结论**：本 sprint 的实质工作 = 新增 **代码↔schema 奇偶回归测试**（Golden Path Step 3）。其余步骤（迁移接受 / 幂等 / 拒绝未知 / selfcheck 同步）在 base 已满足，合同将其作为**回归 oracle** 保留（防退化），而非要求 generator 重写。

> **诚信标注（Relay DONE_WITH_CONCERNS 依据）**：因底层修复已在 base，奇偶测试在 base_sha 上是**绿**的（zod 5 值与迁移 5 值当前一致），它的价值是**永久防漂移守卫**——未来任何人给 zod `failure_class` 加新枚举值却漏配套迁移时，该测试立即变红。经典 TDD "先红" 证据由现有 integration test 的 "before migration 406" 用例承担（迁移前 23514）。

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应。** 本 sprint 只新增 DB 迁移（已存在）与 vitest 回归测试，不新增/修改任何 HTTP 端点，不改 `execution-contract.js` / `derive.js` 业务逻辑（PRD 边界硬约束）。Reviewer 第 6 维 verification_oracle_completeness 对 HTTP schema 部分自动满分；oracle 完整性改由下方 [BEHAVIOR] 的真 PG 断言承担。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `src/__tests__/integration/migration-406-account-exhausted.integration.test.js` → "reproduces the production callback check violation before migration 406"（迁移前 UPDATE `account_exhausted` 必须抛 23514）
- [回归测试] 同上 → "accepts account_exhausted after migration 406 and remains idempotent"（迁移可重复执行；`schema_version` 中 `'406'` 仅一行）
- [回归测试] 同上 → "still rejects an unknown failure class"（`arbitrary_dirty_value` 仍抛 23514 —— 约束**没有**被放宽成"接受任意值"）
- [回归测试] `src/__tests__/migration-406-account-exhausted-class.test.js` → 迁移文本保留 4 旧值且新增 `account_exhausted`，且 `VALUES ('406'`
- [回归测试] `src/orchestrator/__tests__/execution-contract.test.js`、`derive-account-exhausted.test.js`、`quota-exhaustion-classify.test.js` → `execution-contract.js` 把 429/配额语义分类为 `account_exhausted`（本 sprint 不得改动此逻辑）
- [累积FR] context-manifest: unavailable（runtime_resources.postgres=false，本会话未连 Brain；不阻塞，仅记录）
- [SSOT] `execution-contract.js` `__test__.harnessResultSchema.shape.failure_class`（`z.enum(...).optional()`）当前枚举 = `['infrastructure_blocked','semantic_refusal','runner_failure','needs_context','account_exhausted']`（5 值），由本会话 `node` 实测取得，作为奇偶测试的代码侧 SSOT。

## Golden Path

[429/配额耗尽的 attempt 回调] → [derive 分类 failure_class=account_exhausted] → [写库 UPDATE harness_attempts.failure_class] → [DB 约束接受，Brain 不 500，runner 不再无限重试] → [奇偶守卫保证 zod 枚举全集与 DB 约束长期不脱钩]

---

### Step 1: 迁移后 `account_exhausted` 写库被 DB 约束接受（配额耗尽回调恢复）

**来源**: `[FROM_PRD]` — thin_prd "要修什么" 第 1 条 + "验收方向" 第 1 条（迁移后 INSERT/UPDATE `failure_class='account_exhausted'` 成功）。base 已由迁移 406 满足，此步为回归 oracle。

**可观测行为**: 在应用了迁移链（357→366→378→406）的库上，把某 `harness_attempts` 行的 `failure_class` 更新为 `'account_exhausted'` 成功返回，读回值等于 `'account_exhausted'`；迁移前同一 UPDATE 抛 PostgreSQL check 违反（SQLSTATE 23514）。

**验证命令**（真 PG，自举隔离 schema，见 `## E2E 验收` 与 contract-dod BEHAVIOR B-01）:
```bash
# 由 migration-406-account-exhausted.integration.test.js 承担（迁移前红 / 迁移后绿 / 幂等）
npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/migration-406-account-exhausted.integration.test.js --reporter=verbose
```

**硬阈值**: 该 integration test 全部用例 PASS（含 before-migration 23514 复现、after-migration 接受、幂等、拒绝未知）。

---

### Step 2: 迁移幂等 + selfcheck 版本同步

**来源**: `[FROM_PRD]` — thin_prd 边界 "迁移必须幂等" + 验收方向第 3 条 "selfcheck EXPECTED_SCHEMA_VERSION 同步"。base 已满足，回归 oracle。

**可观测行为**: 迁移 406 连续执行两次不报错；`schema_version` 表中 `version='406'` 恰好一行；`selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` 数值 ≥ `migrations/` 下最大迁移号（当前两者均为 406）。

**验证命令**:
```bash
# 幂等由 Step 1 的 integration test "remains idempotent" 用例覆盖；版本同步用 node 直接断言
node -e 'import("./src/selfcheck.js").then(async m=>{const fs=await import("node:fs");const nums=fs.readdirSync("migrations").map(f=>{const x=f.match(/^(\d+)_/);return x?parseInt(x[1],10):0}).filter(Boolean);const max=Math.max(...nums);const exp=parseInt(m.EXPECTED_SCHEMA_VERSION,10);if(exp<max){console.error("FAIL: EXPECTED_SCHEMA_VERSION="+exp+" < max migration="+max);process.exit(1)}console.log("OK exp="+exp+" max="+max)})'
```

**硬阈值**: `EXPECTED_SCHEMA_VERSION`(int) ≥ 最大迁移号(int)，node 退出码 0。

---

### Step 3: 代码↔schema 奇偶校验（唯一净新增 —— 防未来脱钩守卫）

**来源**: `[FROM_PRD]` — thin_prd "要修什么" 第 2 条后半（"再加代码↔schema 奇偶校验回归测试：枚举 execution-contract.js zod schema 中 failure_class 全部枚举值，逐一断言 DB 约束接受，防未来再脱钩"）。**base 无此测试，本 sprint 主交付物。**

**可观测行为**: 一个真 PG 回归测试，**从 `execution-contract.js` 的 zod schema 动态读取** `failure_class` 枚举全集（不硬编码复制清单），在应用迁移 406 后的库上对**每一个**枚举值执行 UPDATE 并断言成功；再对一个不在枚举内的脏值断言被拒（23514）。当且仅当 zod 枚举 ⊆ DB 约束接受集 时全绿——未来有人给 zod 加值却漏迁移，该测试立即红。

**验证命令**（真 PG）:
```bash
npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js --reporter=verbose
```

**硬阈值**: 测试从 zod 读到的枚举值个数 ≥ 5 且逐值 UPDATE 全部成功（0 个 23514）；未知脏值断言被拒。测试文件退出码 0。

---

### Step 4: 未知 failure_class 仍被拒绝（约束未被放宽成"接受任意值"）

**来源**: `[FROM_PRD]` — thin_prd 边界隐含（只追加 `account_exhausted`，不放开约束）+ 现有 integration test "still rejects an unknown failure class"。回归 oracle。

**可观测行为**: 在应用迁移 406 后的库上，UPDATE `failure_class='arbitrary_dirty_value'` 抛 SQLSTATE 23514。

**验证命令**: 由 Step 1 integration test 的 "still rejects an unknown failure class" 用例 + Step 3 奇偶测试的负向断言共同覆盖。

**硬阈值**: 脏值 UPDATE 抛 23514（check violation）。

---

## 禁 mock 边清单

本单触及 **DB 写路径**（`harness_attempts.failure_class` 回调 UPDATE）与 **代码↔schema 一致性接缝**（zod 枚举 ↔ DB CHECK 约束）。以下边**禁 mock**，测试必须真 Postgres：

- 代码 `execution-contract.js` zod `failure_class` 枚举 ↔ DB 约束 `harness_attempts_failure_class_check`（本单核心接缝：奇偶测试必须真连 PG 对每个枚举值真 UPDATE，禁止用内存断言"两个数组相等"替代——那抓不到 DB 约束实际是否接受）
- 代码 ↔ DB 表 `harness_attempts`（回调 UPDATE 写路径：Step 1/3/4 的 UPDATE 必须真 Postgres 验行落库/被拒，禁止 mock pool/`vi.mock('pg')`）
- 允许 mock 的更外层无关依赖：无（本单不涉第三方 API / 通知渠道）

> generator 侧：以上边命中 `vi.mock`/stub/mock pool 即违约（CONTRACT IS LAW）；evaluator 机械 grep 核查。需真 PG 的测试统一放 `packages/brain/src/__tests__/integration/*.integration.test.js`，CI 由 `brain-integration` job（`cecelia_test` Postgres service）跑，`brain-unit` 以 `--exclude='src/__tests__/integration/**'` 自动排除。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 所有 oracle 均真 PostgreSQL 真 UPDATE，无 `force_*`/stub/假数据；不涉第三方 API、不涉设备/agent 调服务端，故真实调用方 shape 段亦 N/A。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | DB 约束 `harness_attempts_failure_class_check` 接受 `account_exhausted`（+ NULL + 4 旧值）；新增奇偶回归测试守护 zod 枚举全集 ⊆ DB 约束接受集 |
| **NFR（做得多好）** | 性能/可靠性 | 迁移幂等（可重复执行）；奇偶测试在隔离 schema 内自举，单文件 < 30s（vitest testTimeout）；不引入对生产库的依赖 |
| **Invariant（永不违反）** | 不变量 | ① `account_exhausted` 是**可恢复**类（不永久拉黑账号，换号重试）；② 约束**只追加不放开**——未知脏值仍必须被拒（23514）；③ 不改 `execution-contract.js`/`derive.js` 业务逻辑（PRD 边界） |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 迁移永久有效；奇偶测试随 zod 枚举演进——加值即须同步迁移，否则测试红（这正是设计目的，不是过期） |
| **死亡告警（停了谁知道）** | 谁多久知道 | 若约束再次与 zod 脱钩：`brain-integration` CI job 立即红 → PR 无法合并；生产运行时 23514 会被 callback-processor 记账并触发 Brain issue（现网已实证 attempt a17d61ac 重试 113+ 次的教训即因缺此守卫） |
| **失败语义（挂了怎么办）** | 放行/拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执验证 | 迁移生效 = `schema_version` 有 `'406'` 行 + UPDATE `account_exhausted` 成功读回；奇偶生效 = 测试对 zod 每个值真 UPDATE 成功、退出码 0 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ zod 枚举全集 ⊆ DB 约束接受集（代码↔schema 是否脱钩） | A. 人工核对两处清单; B. 真 PG 遍历 zod 枚举逐值 UPDATE 断言接受 | B. 真 PG 遍历断言 | 人工核对正是 #4789 脱钩的根因（改 zod 漏改迁移无人发现）；只有真 UPDATE 才反映 DB 约束真实行为 | ⚠️ 脱钩再现 → 生产 429 回调全部 23514 → runner 无限重试、账号轮换失效（现网流血） |
| DB 约束是否"只追加不放开" | A. 只测新值接受; B. 额外测未知脏值被拒 | B | 只测接受无法发现约束被误改成 `CHECK (true)` 之类放开 | 约束形同虚设，脏数据入库 |

> `⚠️` 行属"升拍板点"级别；PrepPRD 已隐含拍板（"防未来再脱钩"即用户诉求），notes 无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 迁移 406 重复执行 | 幂等（DROP IF EXISTS + ADD；schema_version ON CONFLICT DO NOTHING） | 是 | 无需降级 |
| 回调写入 `account_exhausted` 前约束未迁移 | UPDATE 抛 23514，callback 失败，runner 重试 | 是（迁移后即恢复） | 迁移是根治；本 sprint 即补齐迁移+守卫 |
| 奇偶测试环境无 PG | 测试属 `integration/`，`brain-unit` 排除、`brain-integration` 才跑；无 PG 时不在 unit 层误红 | N/A | CI 由 brain-integration 提供 `cecelia_test` |

### 输入对抗面

N/A —— 本 sprint 不新增对外暴露 agent / 接口，纯 DB 迁移 + 内部回归测试。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 无 HTTP 面，也无需启动 Brain server；oracle 全部是"真 PostgreSQL 上的 DB 约束行为 + vitest 回归测试"。Fleet 注入一个 **attempt 级全新空库** `${DB_URL:?}`（数据库名必须以 `_test` 或 `_scratch` 结尾——仓库 integration 测试的 guard 硬要求，防误连生产/开发库）。以下脚本自举：直接复用仓库真实 vitest integration 套件（它们在隔离 schema 内跑真实迁移链），不复制生产数据、不注入任何业务凭据。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped test DB_URL (database name must end in _test or _scratch)}"

# 供仓库 integration 测试消费（它们读 TEST_DATABASE_URL；guard 要求 *_test/_scratch）
export TEST_DATABASE_URL="$DB_URL"
export DATABASE_URL="$DB_URL"

cd packages/brain

# 0. 前置守卫：DB_URL 必须指向 *_test / *_scratch 库（否则仓库 guard 会抛，提前给出可读原因）
node -e 'const u=new URL(process.env.DB_URL);const n=decodeURIComponent(u.pathname.replace(/^\//,""));if(!/(_test|_scratch)$/.test(n)){console.error("FAIL: DB_URL database name must end in _test or _scratch, got "+n);process.exit(1)}console.log("OK db="+n)'

# 1. 真 PG oracle A：迁移 406 接受 account_exhausted + 迁移前 23514 复现 + 幂等 + 拒绝未知（回归）
npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/migration-406-account-exhausted.integration.test.js --reporter=verbose

# 2. 真 PG oracle B：代码↔schema 奇偶（本 sprint 净新增守卫）——从 zod 读枚举全集逐值断言 DB 接受
npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js --reporter=verbose

# 3. 静态不变量（无需 PG）：迁移文本保留 4 旧值 + 新增 account_exhausted + VALUES ('406'
npx vitest run src/__tests__/migration-406-account-exhausted-class.test.js --reporter=verbose

# 4. selfcheck EXPECTED_SCHEMA_VERSION >= 最大迁移号（版本同步）
node -e 'import("./src/selfcheck.js").then(async m=>{const fs=await import("node:fs");const nums=fs.readdirSync("migrations").map(f=>{const x=f.match(/^(\d+)_/);return x?parseInt(x[1],10):0}).filter(Boolean);const max=Math.max.apply(null,nums);const exp=parseInt(m.EXPECTED_SCHEMA_VERSION,10);if(exp<max){console.error("FAIL: EXPECTED_SCHEMA_VERSION="+exp+" < max migration="+max);process.exit(1)}console.log("OK selfcheck exp="+exp+" max="+max)})'

echo "OK: Golden Path 验证通过 (account_exhausted 回调恢复 + 代码/schema 奇偶守卫)"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 给 `harness_attempts.failure_class` UPDATE 一个 zod 枚举**大小写变体**（如 `Account_Exhausted`）或前后带空格（` account_exhausted `）—— 断言仍被 23514 拒绝（约束区分大小写/精确匹配，不得意外接受）
- 重复提交: 迁移 406 连跑 3 次以上（超过现有测试的 2 次），断言仍幂等、`schema_version` `'406'` 仍只 1 行
- 中途中断: 在迁移链应用到 378 之后、406 之前 UPDATE `account_exhausted`（模拟部分迁移态）—— 断言 23514（防止"迁移半途也算通过"的假绿）
- 边界值: `failure_class=NULL` 显式写入 —— 断言接受（约束保留 `IS NULL` 分支）；空字符串 `''` —— 断言被拒（不在枚举）
发现分级: P0/P1（约束意外接受未知值/大小写变体、迁移非幂等、NULL 被误拒）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 代码↔schema 奇偶守卫（净新增） | `packages/brain/src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js` | `accepts every failure_class value declared in the execution-contract zod enum`；`enumerates at least the five known classes from the zod schema`；`still rejects a value outside the zod enum` | 若约束与 zod 脱钩 → 缺失值 UPDATE 抛 23514，用例红（base 上因 #4798 已修复故为绿，红证据由下条既有 integration test 的迁移前用例承担） |
| 迁移接受/幂等/拒绝（既有回归） | `packages/brain/src/__tests__/integration/migration-406-account-exhausted.integration.test.js` | `reproduces the production callback check violation before migration 406`（=经典先红证据）；`accepts account_exhausted after migration 406 and remains idempotent`；`still rejects an unknown failure class` | 迁移前 UPDATE `account_exhausted` → 23514（红） |
| 迁移文本静态不变量（既有回归） | `packages/brain/src/__tests__/migration-406-account-exhausted-class.test.js` | `extends the strict attempt failure-class invariant without removing existing classes` | 迁移缺 `account_exhausted` 或删旧值 → 红 |
