# Sprint Contract Draft (Round 1) — Generator/Publisher 权限边界生产回归

**锚定父路声明**: 独立小路（无父路）—— PRD `journey_id: none`，本 sprint 为独立后端权限边界回归，不覆盖既有 Golden Path 步骤。

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），执行代码层 Contract Gate + 本 skill 内置规则。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 只改 Dispatcher 内部 TaskBundle 装配（`buildInputs`）与新增 smoke/单测，无新增/变更 HTTP 端点。Reviewer 第 6 维 schema 项按 N/A 处理，验收 oracle 落在 node 单测 + bash smoke 的 exit code。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` 现有断言：`spawn:proposer`/`spawn:reviewer` → `runtime_resources == {postgres:false, node_deps:true}`；`spawn:evaluator` → `{postgres:true, node_deps:true}`。**本 sprint 必须保持这三条不回退。**
- [回归测试] `dispatcher.test.js` 现有断言（约 :1843-1844）：`spawn:generator` bundle `not.toHaveProperty('runtime_resources')`。**该断言锁的是旧行为，与本 sprint 目标直接冲突，Generator 必须把它更新为新期望（generator 现有 `runtime_resources.postgres===true`），否则 brain-ci 持续红。**
- [回归测试] `packages/brain/scripts/smoke/gan-node-deps-smoke.sh`：dispatcher 对 proposer/reviewer 默认开 node_deps 的结构 smoke，本 sprint 不得破坏。
- [累积FR] context-manifest: unavailable（PRD `journey_id: none`，payload 无 journey_id，优雅降级——本 line 暂无历史 FR）。
- [MAP_NOT_CONFIGURED] payload 无 `map_scope`/`map_repo`，Unified Map 半径未配置；无 `must_run_assertions` 注入。

## Golden Path

[Dispatcher 组装 role=generator 的 TaskBundle] → [服务端 `buildInputs` 注入 server-owned `runtime_resources.postgres=true`，caller `postgres:false` 不降权 + 角色 objective 边界不变] → [先红后绿单测 + 新增可执行 smoke 永久接入 smoke_pool ratchet]

---

### Step 1: Dispatcher 为 role=generator 组装 TaskBundle 并注入 server-owned postgres
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步（第 18-19 行）、假设第 41-42 行。

**可观测行为**: `buildInputs('spawn:generator', ...)` 组装出的 inputs 含 `runtime_resources.postgres === true`（server-owned），且 caller 通过 payload 传入 `runtime_resources.postgres:false` 时结果仍为 `true`（不降权）。`spawn:generator-fix` 同样为 `true`。

**验证命令**:
```bash
node -e '
import("./packages/brain/src/orchestrator/dispatcher.js").then(({resolveAction,__test__})=>{
  const {buildInputs}=__test__;
  const spec=resolveAction("spawn:generator");
  const ctx={taskId:"t",worktreePath:"/tmp/w",observed:{task:{id:"t",title:"t",description:"d",payload:{sprint_dir:"s",runtime_resources:{postgres:false}}},contract:{approved:true,row:{propose_branch:"cp-x"}}}};
  const inputs=buildInputs("spawn:generator",spec,ctx,{logicalCycleId:"i",attemptKind:"initial",workstreamKey:"ws1"});
  if(inputs.runtime_resources?.postgres!==true){console.error("FAIL: caller false 被降权 / 缺 server-owned postgres");process.exit(1);}
  console.log("OK: generator server-owned postgres===true, caller false 未降权");
});'
```

**硬阈值**: `runtime_resources.postgres === true`（default + caller-false + generator-fix 三态）。
**验证命令（硬阈值→可执行）**: 见上 node -e（exit 0 即三态满足；permanent 单测 3 条 it 覆盖三态）。

---

### Step 2: 角色 objective 边界保持（Generator 只产本地候选；Publisher 唯一远端发布）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（第 19 行）、边界情况第 30-31 行、范围限定第 37 行。

**可观测行为**: `dispatcher.js` `OBJECTIVES.generator` 明确 "Do not push or create a pull request"（Generator 无 push/PR/merge 授权）；`OBJECTIVES.publisher` 为 "Publish only the exact local candidate authorized by the Judge and merge fence"（唯一远端发布角色）。本 sprint 不扩大凭据/权限，两条 objective 文本不被削弱。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh
```

**硬阈值**: smoke 三条边界全过、exit 0；任一边界破坏 → 非零退出并打印失败边界名。

---

### Step 3: 新增 RED 回归单测（先红后绿，永久留在 CI）
**来源**: `[FROM_PRD]` — PRD 可观测结果第 21 行、假设第 41 行。

**可观测行为**: 新增 `packages/brain/src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js`，断言消费 Dispatcher 真实 `buildInputs` 组装出的 generator TaskBundle：修前红（generator 缺 server-owned postgres），修后绿；永久留在 brain-ci 作回归。

**验证命令**:
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js --reporter=basic
```

**硬阈值**: 修后 3 tests passed；同时既有 `dispatcher.test.js` 冲突断言已更新为新期望后全绿。

---

### Step 4: 新增可执行 smoke 永久接入 smoke_pool ratchet
**来源**: `[FROM_PRD]` — PRD 可观测结果第 22 行、假设第 43 行、预期受影响文件第 71-72 行。**wiring 决策来源**: `[AI_ADDED]` — Planner 显式把 smoke↔ratchet 计数归属的 wiring 决策交给 Proposer（PRD 假设第 43 行）；理由见下「smoke↔ratchet wiring 决策」。

**可观测行为**:
- 权威可执行 smoke 落 `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh`（PRD 指定路径；由 ci.yml `SMOKE_DIR=packages/brain/scripts/smoke` glob 自动接 brain-real-env-smoke CI 跑道，line 1599）。
- smoke_pool ratchet 的度量源是 `walkSh(<root>/scripts/smoke)`（`scripts/ratchet-guard.mjs` 第 96 行），**只数 top-level `scripts/smoke/`，不数 `packages/brain/scripts/smoke/`**。为让新 smoke 永久计入 smoke_pool，新增**真实（非 symlink）委派 wrapper** `scripts/smoke/generator-publisher-boundary-smoke.sh`，`exec` 调权威 smoke。wrapper 被 `walkSh` 计入（`Dirent.isFile()` 对 symlink 为 false，故必须是真实文件），且被 dashboard 放行闸 `scripts/smoke/*-smoke.sh` glob（ci.yml line 453）执行——因此 wrapper/权威 smoke 都必须**依赖免装、无 DB**（dashboard-gate job 无 npm ci / 无 Postgres）。
- `scripts/ratchet-registry.json` 的 `smoke_pool.watermark` 由 13 上调为 14（only_up；新 smoke 永久成员）。

**验证命令**:
```bash
bash scripts/smoke/generator-publisher-boundary-smoke.sh && \
node scripts/ratchet-guard.mjs --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const sp=JSON.parse(s).results.find(r=>r.name==="smoke_pool");if(!sp||sp.status!=="pass"||sp.watermark<14){console.error("FAIL: smoke_pool 未上调/未通过",JSON.stringify(sp));process.exit(1);}console.log("OK smoke_pool watermark="+sp.watermark+" value="+sp.value);})'
```

**硬阈值**: wrapper exit 0；smoke_pool `status=pass` 且 `watermark >= 14`（由 13 上调）且 `value` 计入新 wrapper。

---

## smoke↔ratchet wiring 决策（Proposer 解析，Planner 显式移交）

| 事实 | 证据 |
|---|---|
| smoke_pool 度量源只数 top-level `scripts/smoke/` | `scripts/ratchet-guard.mjs:96` `walkSh(path.join(root,'scripts','smoke'))` |
| `walkSh` 不数 symlink（`isFile()` 对 symlink 为 false） | `scripts/ratchet-guard.mjs:30-37` |
| `packages/brain/scripts/smoke/*.sh` 由独立 CI job 跑（非 smoke_pool 计数） | `.github/workflows/ci.yml:1599` `SMOKE_DIR=packages/brain/scripts/smoke` |
| dashboard 放行闸跑 `scripts/smoke/*-smoke.sh`（无 npm ci/无 DB） | `.github/workflows/ci.yml:439-460` |

**决策**：权威 smoke 放 PRD 指定的 `packages/brain/scripts/smoke/`（brain CI 自动跑）；top-level 加**真实委派 wrapper** `scripts/smoke/generator-publisher-boundary-smoke.sh`（smoke_pool 计入 + dashboard 闸执行）；watermark 13→14。两处 smoke 都必须依赖免装、无 DB、纯源结构断言（因 dashboard-gate 无 deps）——真值行为断言由 permanent vitest（真 `buildInputs`）承担，smoke 承担永久结构 ratchet。**不改 smoke_pool 度量源语义**（避免把 count 从 38 暴涨到数百，超出 sprint scope）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | Dispatcher 为 role=generator 注入 server-owned `runtime_resources.postgres=true`，caller `postgres:false` 不降权；保持 Generator 只产本地候选 / Publisher 唯一远端发布的 objective 边界；新增 RED 回归单测 + 可执行 smoke 接入 smoke_pool ratchet |
| **NFR（做得多好）** | 非功能 | smoke 依赖免装、无 DB、可 CI 长期反复运行且幂等；失败非零退出并打印失败边界名 |
| **Invariant（永不违反）** | 不变量 | 不扩大任何凭据/权限；Generator 仍无 push/PR/merge；Publisher 权限不变；proposer/reviewer/evaluator 现有 runtime_resources 语义不回退；不改 GAN 拓扑与角色链 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | 永久回归（无过期）；smoke_pool only_up watermark 永久锁定新成员 |
| **死亡告警（停了谁知道）** | 告警 | smoke 是 CI required 跑道成员（brain-real-env-smoke + dashboard 放行闸 + smoke_pool ratchet），退化即红闸阻断合并，PR 作者第一时间知道 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 单测 exit 0 + smoke exit 0 + ratchet-guard smoke_pool status=pass；均为可复跑机检回执 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A）—— 纯 Brain 内部 Dispatcher 装配 + 源结构 smoke，无 RPA/真机/外部状态推断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| smoke 断言某边界不满足 | 非零退出 + 打印失败边界名，禁止静默假绿 | 是（纯源结构断言，无副作用） | 无降级——边界破坏必须红 |
| 源文件缺失（容器镜像未带 scripts/dispatcher，ENOENT） | echo SKIP + exit 0（既有降级语义，不假红也不假绿） | 是 | ENOENT 放行 |
| Brain 不可达（ratchet-guard 的 Brain 依赖指标） | smoke_pool 为本地文件计数，不依赖 Brain；bare_fr/seven_ring 指标 `skip_if_brain_unavailable` 自动 skip | 是 | 既有 skip 语义 |

### 输入对抗面（对外暴露 agent 必填）

N/A —— 本 sprint 只改 Dispatcher 内部装配与 CI smoke，不对外暴露任何 agent 输入面。

## 禁 mock 边清单

本单改动涉及「跨模块数据传递」（Dispatcher `buildInputs` 组装 TaskBundle inputs → 下游角色运行时资源）与角色边界配置，故：

- 代码 ↔ Dispatcher `buildInputs` 真实装配：permanent 单测与 smoke 的行为断言必须真调 `resolveAction` + `__test__.buildInputs`（真实 dispatcher 模块），**禁止 mock/stub `buildInputs` 或 `OBJECTIVES`**。测试组装的是 Dispatcher 真实产出的 generator TaskBundle，非替身。
- 本单不触及 DB 写路径（无 INSERT/UPDATE），故无「代码↔DB 表」禁 mock 边；smoke 与单测均无需真 Postgres（`buildInputs` 为纯函数装配）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| generator server-owned postgres | `tests/generator-runtime-resource-boundary.test.js`（永久落点 `packages/brain/src/orchestrator/__tests__/`）| `runtime_resources postgres 为 true`；`postgres false 不降权 postgres 仍为 true`；`generator-fix 重派同样注入 server-owned postgres 为 true` | → 3 failures（现 generator `runtime_resources===undefined`）|

> 「BEHAVIOR 覆盖」列每个名均为对应 `it()` 名的字面子串（`grep -F` 可命中）。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 的验收对象是 Dispatcher 纯函数装配（`buildInputs`）+ 源结构 smoke + ratchet 计数，**不依赖数据库**（无迁移/无真库读写/无业务身份），故不套 local_api 空库 signup/login 自举模板（该模板条件为「依赖数据库时」）。亦不需要运行中的 Brain（5221）。全部验收 = node 单测 + node 行为断言 + bash smoke + node ratchet-guard，本地可跑、可复跑、exit code 驱动。

```bash
#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "[e2e] 0. 前置：纯 orchestrator 单测 + 源结构 smoke，无需 Postgres/Brain"

echo "[e2e] 1. 永久回归单测（server-owned postgres + caller false 不降权 + generator-fix）→ 绿"
# 永久单测跑 brain 自有 vitest 配置（根 vitest include 不覆盖 packages/brain/src/**，故必须 cd packages/brain）
( cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js --reporter=basic )

echo "[e2e] 2. caller postgres:false 不降权（真 buildInputs 行为断言，非替身）"
node -e 'import("./packages/brain/src/orchestrator/dispatcher.js").then(function(m){var buildInputs=m.__test__.buildInputs;var spec=m.resolveAction("spawn:generator");var ctx={taskId:"t",worktreePath:"/tmp/w",observed:{task:{id:"t",title:"t",description:"d",payload:{sprint_dir:"s",runtime_resources:{postgres:false}}},contract:{approved:true,row:{propose_branch:"cp-x"}}}};var inputs=buildInputs("spawn:generator",spec,ctx,{logicalCycleId:"i",attemptKind:"initial",workstreamKey:"ws1"});if(inputs.runtime_resources&&inputs.runtime_resources.postgres===true){console.log("OK: caller false 未降权 postgres===true");}else{console.error("FAIL: postgres 非 server-owned true");process.exit(1);}}).catch(function(e){console.error("FAIL:",e.message);process.exit(1);});'

echo "[e2e] 3. 权限边界 smoke（3 条边界）→ exit 0"
bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh

echo "[e2e] 4. 顶层 wrapper smoke（依赖免装，供 dashboard 放行闸 + ratchet 计数）→ exit 0"
bash scripts/smoke/generator-publisher-boundary-smoke.sh

echo "[e2e] 5. smoke 已接入 smoke_pool ratchet（status=pass 且 watermark 上调至 >=14）"
node scripts/ratchet-guard.mjs --json 2>/dev/null | node -e 'var s="";process.stdin.on("data",function(d){s+=d;}).on("end",function(){var sp=JSON.parse(s).results.find(function(r){return r.name==="smoke_pool";});if(!sp||sp.status!=="pass"||sp.watermark<14){console.error("FAIL: smoke_pool 未上调/未通过 "+JSON.stringify(sp));process.exit(1);}console.log("OK smoke_pool watermark="+sp.watermark+" value="+sp.value);});'

echo "[e2e] 6. 既有冲突单测已更新为新期望（generator 现有 runtime_resources）→ 全绿"
( cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=basic )

echo "✅ Golden Path 验证通过（Generator server-owned postgres + 角色边界 + RED→GREEN + smoke ratchet）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `buildInputs` 传 payload `runtime_resources` 为非法形状（如 `postgres:"false"` 字符串 / `runtime_resources:null` / 缺字段）→ 断言 server 端仍注入 `postgres===true`（boolean），不被 caller 污染。
- 重复提交: 连续两次跑 smoke / ratchet-guard → 幂等，count/watermark 不漂移、无副作用文件残留。
- 中途中断: smoke 执行中 kill → 无 trap 泄漏的临时文件；再跑一次仍 exit 0。
- 边界值: 其他角色（proposer/reviewer/evaluator）bundle 的 runtime_resources 未被本次改动波及（回归三态断言）；`spawn:generator-fix` 与 `spawn:generator` 一致。
发现分级: P0/P1（Generator 拿不到 server-owned postgres / caller 能降权 / 其他角色语义回退）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## 参考实现：权威 smoke（Generator 落 `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh`）

> 依赖免装、无 DB、纯源结构断言（dashboard-gate 无 deps 也能跑）；行为真值由 permanent vitest 承担。ENOENT 降级放行。

```bash
#!/usr/bin/env bash
# Generator/Publisher 权限边界结构 smoke（永久回归）。
# 三条边界：① generator server-owned postgres 注入接线 ② generator 只产本地候选（禁 push/PR）
# ③ publisher 唯一远端发布角色。依赖免装、无 DB。
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
DISPATCHER="${REPO_ROOT:-.}/packages/brain/src/orchestrator/dispatcher.js"

# ENOENT 降级：源文件缺失（容器镜像未带 scripts）→ SKIP 放行，不假红也不假绿
if [ ! -f "$DISPATCHER" ]; then
  echo "[gen-pub-boundary-smoke] SKIP: dispatcher.js 不存在（ENOENT 降级放行）"
  exit 0
fi

fail() { echo "[gen-pub-boundary-smoke] FAIL 边界: $1" >&2; exit 1; }

echo "[gen-pub-boundary-smoke] 边界①: generator 纳入 server-owned runtime_resources.postgres 注入"
grep -Eq "\['proposer', 'reviewer', 'evaluator', 'generator'\]\.includes\(spec\.role\)" "$DISPATCHER" \
  || fail "generator 未纳入 runtime_resources 注入角色列表"
grep -Eq "postgres: \['evaluator', 'generator'\]\.includes\(spec\.role\)" "$DISPATCHER" \
  || fail "generator 未被授予 server-owned postgres=true"

echo "[gen-pub-boundary-smoke] 边界②: generator objective 只产本地候选（禁 push/PR）"
grep -q "Do not push or create a pull request" "$DISPATCHER" \
  || fail "generator objective 缺 '禁 push/PR' 边界"

echo "[gen-pub-boundary-smoke] 边界③: publisher 唯一远端发布角色"
grep -q "Publish only the exact local candidate authorized by the Judge and merge fence" "$DISPATCHER" \
  || fail "publisher objective 边界被削弱"

echo "[gen-pub-boundary-smoke] 三条边界全过 ✓"
exit 0
```

## 参考实现：top-level 委派 wrapper（Generator 落 `scripts/smoke/generator-publisher-boundary-smoke.sh`）

> 真实文件（非 symlink），被 smoke_pool `walkSh` 计入 + dashboard 放行闸执行。仅 `exec` 委派权威 smoke。

```bash
#!/usr/bin/env bash
# smoke_pool ratchet 计数成员 + dashboard 放行闸执行入口。
# 委派到权威 brain smoke（依赖免装、无 DB），保持单一真源。
set -euo pipefail
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
exec bash "$REPO_ROOT/packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh" "$@"
```

## 参考实现：dispatcher.js 最小改动（已在 proposer 环境 RED→GREEN 验证）

```javascript
// packages/brain/src/orchestrator/dispatcher.js（约 :519-521）
// 改前：if (['proposer', 'reviewer', 'evaluator'].includes(spec.role)) {
//         common.runtime_resources = { postgres: spec.role === 'evaluator', node_deps: true };
// 改后：
  if (['proposer', 'reviewer', 'evaluator', 'generator'].includes(spec.role)) {
    common.runtime_resources = { postgres: ['evaluator', 'generator'].includes(spec.role), node_deps: true };
  }
```

> 同时更新 `dispatcher.test.js`（约 :1843-1844）冲突断言：`expect(created.bundle.inputs).not.toHaveProperty('runtime_resources')` → `expect(created.bundle.inputs.runtime_resources).toEqual({ postgres: true, node_deps: true })`（并同步注释）。
