# Sprint Contract Draft (Round 1) — Generator/Publisher 权限边界生产回归

**锚定父路声明**: 独立小路（无父路） — PRD `journey_id=none / step_id=none`，本 sprint 是一条新增的永久角色权限边界回归，无既有 Golden Path 父路。

**map radius**: `[MAP_NOT_CONFIGURED]` — task.payload `map_repo=null` / `expected_files=null`（仅 `map_scope=["F1"]`），Unified Map radius 未配置，无 `must_run_assertions` 注入；按 skill 明确标注，不回退领域硬编码。

**contract-gate**: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在 → 代码层 Contract Gate 生效，本合同断言按 gate 惯用法书写（exit-code 驱动，无 curl-no-jq / 无 `|| true` 吞错 / DB 计数带时间窗，本单无 DB 写路径）。

**gp-anchor**: skipped (product-map.json not found) — cecelia 仓无 `product-map/generated/product-map.json`。

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 改动为 Dispatcher 内部 TaskBundle 组装（`buildInputs` 纯装配）+ 源结构 smoke + ratchet 接入，不新增/不改任何 HTTP 端点。Reviewer 第 6 维 verification_oracle_completeness 的 schema 部分自动满分；oracle 完整性由下方 permanent vitest（真值行为断言）+ smoke（源结构断言）承担。

---

## 已知约束

### 来自回归测试（Step 1.2）
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → `运行时依赖预装：proposer/reviewer TaskBundle 默认注入 runtime_resources.node_deps=true`（`{postgres:false,node_deps:true}`）
- 同文件 → `Evaluator 默认申请隔离 PostgreSQL 并预装 node 依赖`（`{postgres:true,node_deps:true}`）
- 同文件 → `generator bundle 从已批准合同导出 contract_branch`（`:1844` 现断言 `expect(created.bundle.inputs).not.toHaveProperty('runtime_resources')`）
- `packages/brain/scripts/smoke/evaluator-no-push-smoke.sh` → evaluator push 被 GIT_CONFIG pushurl 阻断、remote SHA 不变（同族"角色不越权发布"回归的写法范式）

### 冲突单测（本 sprint 必须更新，否则 brain-ci 持续红）
- **`dispatcher.test.js:1842-1844`**：现锁"generator 不该被塞 runtime_resources"的旧行为。本 sprint 让 generator 获得 `{postgres:true,node_deps:true}` → 该断言必反转为 `expect(created.bundle.inputs.runtime_resources).toEqual({ postgres: true, node_deps: true })`（含注释更新）。proposer 已实证：不改此断言，`brain-ci` 的 dispatcher.test.js 该用例转红。

### 累积 FR（Step 1.3）
- context-manifest: `journey_id=none`，无 line 累积 FR 可取（PRD 已注明本 line 暂无历史）。

### Registry / Map
- api/db/test registry 查询为空 → 字段命名 `[NEW_PATTERN]`（但本单无新 HTTP 端点，实际不产出新字段）。
- Unified Map radius `[MAP_NOT_CONFIGURED]`。

---

## Golden Path

[Dispatcher 组装 generator 角色 TaskBundle] → [服务端注入 server-owned runtime resource + 锁角色边界] → [RED→GREEN permanent vitest + 源结构 smoke 接入 ratchet]

---

### Step 1: Dispatcher 为 role=generator 组装 TaskBundle，服务端注入 server-owned `runtime_resources.postgres=true`
**来源**: `[FROM_PRD]` — Golden Path 步骤 1-2（PRD "具体：1./2."）+ 范围内第 1 条。

**可观测行为**: `spawn:generator` 动作经 `buildInputs` 组装出的 TaskBundle，`inputs.runtime_resources` === `{ postgres: true, node_deps: true }`（当前 baseline 为 `undefined`）。generator 与既有 proposer/reviewer/evaluator 一样由服务端在 `dispatcher.js:519-521` 注入 `runtime_resources`；postgres 对 generator 取 true（server-owned）。

**验证命令**（permanent vitest，真消费真实 `buildInputs` 组装的 bundle，无 DB）:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js
# 期望：3 tests passed（含 server-owned postgres + caller false 不降权 + 角色边界）
```

**硬阈值**: `bundle.inputs.runtime_resources` 深等 `{postgres:true,node_deps:true}`；vitest exit 0。

---

### Step 2: caller `runtime_resources.postgres=false` 不得降权（server-owned，caller 不可覆盖）
**来源**: `[FROM_PRD]` — PRD 边界情况第 1 条 + 范围内"caller false 不降权"。

**可观测行为**: 即使 `task.payload.runtime_resources.postgres=false`，组装出的 generator TaskBundle `inputs.runtime_resources.postgres` 仍为 `true`。根因：`buildInputs` 从不读取 caller payload 的 `runtime_resources`，`common.runtime_resources` 完全由服务端按角色构造——caller payload 无法覆盖。本 sprint 的实现只需把 generator 纳入服务端注入分支即可天然满足"不降权"。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js -t "caller postgres:false 不降权"
# 期望：1 passed —— 组装 bundle 仍 postgres===true
```

**硬阈值**: caller payload `postgres:false` 时 `bundle.inputs.runtime_resources.postgres===true`。

---

### Step 3: generator/publisher 角色边界锁定 + 源结构 smoke 永久接入 ratchet
**来源**: `[FROM_PRD]` — Golden Path 步骤 2（objective 边界）+ 步骤 3（新增 smoke + 接入 ratchet）。`[AI_ADDED]` 分量：allowlist 注册 + top-level 委派 wrapper + watermark 上调（理由：让 PRD 要求的"永久接入 smoke ratchet"在 cecelia 双 ratchet 机制下真正生效并可机检，见下方"smoke↔ratchet 接线"）。

**可观测行为**:
- `OBJECTIVES.generator` 明确"只产本地已提交候选（committed local candidate），不 push / 不建 PR，Publisher 负责远端发布"；`OBJECTIVES.publisher` 为"只发布 Judge 与 merge fence 授权的 exact 本地候选"（唯一远端发布角色）。这两段文本在 baseline 已存在，本 sprint 不改语义、只由 smoke 钉死为回归。
- 新增可执行 smoke `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh` 断言 B1/B2/B3 三条边界，纯源结构、免装 npm、无 DB，可 CI 长期反复运行；失败非零退出并打印失败边界名。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh
# 期望：exit 0，stdout 含 "PASS: B1 ... | B2 ... | B3 ..."
```

**硬阈值**: smoke exit 0 且 stdout 含 `PASS: B1`；实现前跑同一 smoke 必红（`FAIL[B1]`）。

---

## smoke↔ratchet 接线（Proposer 解析，Planner 显式移交）

cecelia 有两套 smoke ratchet，本 sprint 都要接：

1. **`run-smoke-ratchet.sh` allowlist 闸（真正的执行 + 登记闸，`ci-smoke-glob-runner.yml`）**：`SMOKE_DIR=packages/brain/scripts/smoke`，glob `*.sh`，每个脚本必须登记在 `packages/quality/smoke-allowlist.txt` / `smoke-denylist.txt` / `smoke-debt.txt` 之一，否则 `UNREGISTERED → CI 红`。**权威 smoke 落 PRD 指定路径 `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh` 并登记进 `smoke-allowlist.txt`（must-pass）。**
2. **`ratchet-registry.json` 的 `smoke_pool`（PRD 显式点名，`ratchet-guard.mjs:94` walkSh 递归数 `scripts/smoke/*.sh` 真实文件，only_up）**：该指标只数 **top-level `scripts/smoke`**，不数 `packages/brain/scripts/smoke`。proposer 实测当前值=38、watermark=13（watermark 是下限，非等值）。为让 PRD 要求的"watermark 随新 smoke 上调"真实生效，**在 `scripts/smoke/` 加一个真实委派 wrapper `generator-publisher-boundary-smoke.sh`（exec 权威 smoke），smoke_pool 计入 +1（38→39），watermark 上调 13→14**（单调 +1 增量，反映本轮新增一个 smoke；不谎报为等值）。

两个 smoke 都依赖免装 / 无 DB / 纯源结构断言，因此在任何 runner（含无 Brain/无 DB 环境）都能稳定跑绿；**真值行为断言（postgres===true、caller false 不降权）由 permanent vitest 承担**，两层不互替。

---

## 禁 mock 边清单

本单改动涉及**调度（Dispatcher 派发组装）+ 跨模块数据传递（runtime_resources 注入进 TaskBundle.inputs，下游 Fleet Worker 消费）**，故清单非空：

- **`dispatcher.buildInputs` ↔ generator `TaskBundle.inputs.runtime_resources`**（本单改的就是这条注入边）：permanent vitest 必须消费**真实** `createDispatcher`→`buildInputs` 组装出的 bundle，**不得** `vi.mock`/stub 掉 `dispatcher.js`/`buildInputs`/`resolveAction`/`OBJECTIVES`。只允许 mock 更外层无关依赖：`attemptStore`（createAttempt/markStarting/…）、`launcher`、`registry.resolve`、`loadSkill`、`randomUUID`、`createCallbackSecret`。
- **无 DB 写路径**：本单不触达任何 Postgres INSERT/UPDATE/迁移，故无"代码↔DB 表"禁 mock 边。

（generator 测试正是这样写的：真 `buildInputs`，仅 mock 外层 deps。evaluator 侧机械 grep 命中清单内的 `vi.mock('.../dispatcher')` = CONTRACT-IS-LAW FAIL。）

---

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 无第三方 API / 无 force_*/stub/假数据。permanent vitest 只 mock `buildInputs` 外层无关依赖（attemptStore/launcher/registry），**被改的注入边 `buildInputs`→`TaskBundle.inputs.runtime_resources` 不 mock**（见"禁 mock 边清单"）；真值行为断言消费真实组装的 bundle。无设备/agent 真实调用方接缝（Dispatcher 内部组装），故无 `## 真实调用方请求 shape` 段。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | Dispatcher 为 role=generator 注入 server-owned `runtime_resources.postgres=true`（caller false 不降权）；generator=只产本地已提交候选（不 push/PR/CI/merge），publisher=唯一远端发布角色；新增 RED→GREEN permanent vitest + 源结构 smoke，smoke 永久接入 ratchet |
| **NFR（做得多好）** | | smoke 免装 npm / 无 DB / 可 CI 长期反复运行、不依赖一次性状态；失败非零退出并打印失败边界名（禁静默假绿）；改动最小（一处注入分支 + 一处冲突断言更新） |
| **Invariant（永不违反）** | | 不扩大任何凭据/权限——generator 仍无 push/PR/merge 授权，publisher 权限不变；不改其他角色 runtime_resources 语义；不改 GAN 拓扑/角色链 |
| **判定点（怎么知道）** | | 见判定点登记表 —— 本任务无接缝真机/外部状态推断判定点，N/A |
| **保质期（何时过期）** | | 永久回归（无过期）；随 dispatcher.js 角色注入结构演进由 smoke/vitest 结构断言守护，结构漂移即红 |
| **死亡告警（停了谁知道）** | | vitest 属 brain-ci required job，smoke 属 ci-smoke-glob-runner allowlist（must-pass）+ nightly-regression；任一转红即在对应 CI 阻断并可见 |
| **失败语义（挂了怎么办）** | | smoke: dispatcher.js 缺失（镜像未带 src）→ ENOENT 放行 exit 0（降级，不假绿不误红）；断言失败→打印 `FAIL[Bn]` 非零退出（拦截）。vitest: 断言失败→CI 红（拦截）。均幂等可重跑 |
| **效果确认（已发≠已生效）** | | permanent vitest 真消费 `buildInputs` 组装的 generator bundle 断言 `postgres===true` 且 caller false 不降权（不是只看文件存在）；smoke 解析真实 dispatcher.js 源结构断言三边界；ratchet 接入由 allowlist 含条目 + smoke_pool 计数上调 + ratchet-guard 通过共同确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |

（本任务无接缝判定点，N/A —— 纯后端 TaskBundle 组装 + 源结构断言，无真机/外部真实状态推断。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| smoke: dispatcher.js 不存在 | 打印 SKIP 放行 exit 0 | 是 | 降级放行（镜像未带 src），不假绿不误红 |
| smoke: B1/B2/B3 断言失败 | 打印 `FAIL[Bn]:<原因>` exit 1 | 是（纯读源，无副作用） | 无降级——边界破坏必须红 |
| vitest: 断言失败 | brain-ci 转红 | 是（deps 全 mock，无外部状态） | 无降级 |

### 输入对抗面

N/A —— 本 sprint 不涉及对外暴露 agent / 外部可写入接口（Dispatcher 内部组装 + CI smoke）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `spawn:generator-fix`（generator 的第二动作）是否同样获得 server-owned postgres（应与 `spawn:generator` 一致，两者 `spec.role==='generator'`）——验证注入按 `spec.role` 而非 action 名。
- 重复提交: 连续两次 `createDispatcher(...)('spawn:generator', ...)` 组装的 bundle `runtime_resources` 应一致且不互相污染（`common` 对象每次新建）。
- 中途中断: caller payload 同时传 `runtime_resources.postgres=false` **且** `node_deps=false` → 服务端仍产 `{postgres:true,node_deps:true}`（caller 完全不可覆盖）。
- 边界值: 其他角色（proposer/reviewer/evaluator/judge/publisher/commander）的 `runtime_resources` 语义保持不变（回归零蔓延）——尤其 judge/publisher/commander 仍无 `runtime_resources` 字段。
发现分级: P0/P1（generator 未获 postgres / caller 能降权 / 其他角色语义被改）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 的 local_api 不依赖数据库：`buildInputs` 是纯装配，permanent vitest 的 deps 全 mock，smoke 纯读源。故**不套空库 signup/login 自举模板**（无 `DB_URL` 资源需求）。Fleet 注入的 `HARNESS_*` 身份仅在真实执行角色内 late-bound，本合同不写任何 attempt/capability UUID 字面值。

```bash
#!/bin/bash
set -euo pipefail
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# 1. permanent 回归 vitest：真消费 buildInputs 组装的 generator TaskBundle（无 DB）
#    实现后必绿（server-owned postgres + caller false 不降权 + 角色边界）
( cd packages/brain && npx vitest run \
    src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js ) \
  || { echo "FAIL: generator runtime-resource boundary vitest 未全绿"; exit 1; }

# 2. 冲突单测已被更新为新期望（generator 现在应有 runtime_resources）：
#    整个 dispatcher.test.js 必须全绿（含 :1844 反转后的断言）
( cd packages/brain && npx vitest run \
    src/orchestrator/__tests__/dispatcher.test.js -t "generator bundle 从已批准合同导出 contract_branch" ) \
  || { echo "FAIL: dispatcher.test.js 冲突断言未更新为新期望"; exit 1; }

# 3. 源结构 smoke（权威路径，brain CI glob 跑）：三条边界全过、exit 0
bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh \
  | grep -q "PASS: B1" \
  || { echo "FAIL: generator-publisher-boundary smoke 未过三边界"; exit 1; }

# 4. 顶层委派 wrapper 也过（smoke_pool 计入的那一个）
bash scripts/smoke/generator-publisher-boundary-smoke.sh \
  | grep -q "PASS: B1" \
  || { echo "FAIL: top-level 委派 wrapper 未过"; exit 1; }

# 5. smoke 已登记进 allowlist（run-smoke-ratchet 的 must-pass 闸）
grep -qxF "generator-publisher-boundary-smoke.sh" packages/quality/smoke-allowlist.txt \
  || { echo "FAIL: smoke 未登记进 smoke-allowlist.txt（会被判 UNREGISTERED CI 红）"; exit 1; }

# 6. smoke_pool 计数已上调 + watermark 上调 + ratchet-guard 通过（value>=watermark）
POOL=$(find scripts/smoke -type f -name '*.sh' | wc -l | tr -d ' ')
WM=$(node -e "const r=require('./scripts/ratchet-registry.json');console.log(r.find(m=>m.name==='smoke_pool').watermark)")
[ "$WM" -ge 14 ] || { echo "FAIL: smoke_pool watermark 未上调到 >=14（当前 $WM）"; exit 1; }
[ "$POOL" -ge "$WM" ] || { echo "FAIL: smoke_pool 计数 $POOL < watermark $WM（ratchet 会红）"; exit 1; }
node scripts/ratchet-guard.mjs 2>/dev/null | grep -qiE "smoke_pool.*(ok|pass|✅|通过)" \
  || node scripts/ratchet-guard.mjs >/dev/null 2>&1 \
  || { echo "FAIL: ratchet-guard 未通过"; exit 1; }

echo "✅ Golden Path 验证通过：generator server-owned postgres + caller 不降权 + 角色边界 + smoke 接入 ratchet"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| generator server-owned runtime resource + 角色边界 | `tests/generator-runtime-resource-boundary.test.js`（Generator 落库到 `packages/brain/src/orchestrator/__tests__/`） | `server-owned runtime_resources.postgres`、`caller postgres:false 不降权`、`generator objective ... Publisher 是唯一远端发布角色` | baseline: 2 failed（runtime_resources undefined）| 1 passed（objective 已在源）→ 实现后 3 passed |

> 「BEHAVIOR 覆盖」列每个名均为 `tests/generator-runtime-resource-boundary.test.js` 中对应 `it()` 名的字面子串。
