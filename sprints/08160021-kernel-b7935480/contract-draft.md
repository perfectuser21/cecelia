# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api
**map_scope**: F1 / map_repo=null → `[MAP_NOT_CONFIGURED]`（radius 未配置，不回退领域硬编码）

## 锚定父路声明

独立小路（无父路）—— journey_id=none / step_id=none，PrepPRD 未锚定任何 Golden Path，本 sprint 是一条独立的「Generator/Publisher 权限边界回归护栏」小路。

---

## Response Schema（推导来源: PRD 字面 + api_registry 现状）

本 sprint **不新增 HTTP 端点**。涉及两类可机检契约：

### 1. attempt-runner.cjs 断言锚点（新增导出，纯函数，供回归护栏直调）

新增到既有 `module.exports.__test__`（沿用现有 `__test__` 冻结对象约定，不改角色流水线）：

- `roleNeedsGitHubCredential(role: string): boolean`
  - 语义：`role ∈ GITHUB_CREDENTIAL_ROLES`（现值 `{planner, proposer, evaluator, publisher}`）。
  - 约束：`'generator'` → `false`（无远端凭据，结构性不能 push）；`'publisher'` → `true`。
  - 来源：现有 `GITHUB_CREDENTIAL_ROLES`（attempt-runner.cjs:29-34）+ 凭据注入门（:501,:1812）。
- `resolveRuntimeRequirements(inputRequirements, requestRequirements): { postgres: boolean, node_deps?: boolean }`
  - 语义：`inputRequirements` = 服务端 bundle 权威，`requestRequirements` = caller 请求，二者按 `stableJson` 值比较；presence 或值不一致 → `throw Error('attempt_runtime_requirements_mismatch')`；字段非法 → `throw Error('attempt_runtime_requirements_invalid')`；匹配则返回服务端拥有的 `{postgres, node_deps?}`（`postgres:true` 不被 caller `false` 降权）。
  - 来源：现有 `taskExecutionContract`（attempt-runner.cjs:1109-1155）内联逻辑抽出为具名纯函数并被原处复用，**行为等价**，不改运行流水线。
- `roleRetainsCandidate(role: string, statusCode: number): boolean`
  - 语义：`role==='generator' && statusCode===0`（Generator 退出码 0 → 保留本地已提交候选 `status=candidate`）。来源：attempt-runner.cjs:1647-1648。
- `roleIsRemotePublisher(role: string): boolean`
  - 语义：`role==='publisher'`（唯一远端发布角色，接手 exact candidate 后 push/PR/CI/merge）。来源：attempt-runner.cjs:1685。

**禁用字段名**（不得改写既有契约的返回/错误标识）：错误码必须字面用 `attempt_runtime_requirements_mismatch` / `attempt_runtime_requirements_invalid`，禁用同义改写（`runtime_mismatch`/`downgrade_rejected`/`postgres_required` 等）。运行时资源字段字面用 `postgres` / `node_deps`，禁用 `pg`/`database`/`db` 等。

### 2. 既有端点 GET /api/brain/quality/ratchet（不改，仅作 ratchet 台账 oracle）

**Success (HTTP 200)**:
```json
{"available": true, "registry": [{"name":"smoke_pool","label":"...","direction":"only_up","watermark":<int>,"guard":"...","source":"find scripts/smoke -name '*.sh' | wc -l"}]}
```
**Degraded (HTTP 200，容器镜像未带 scripts/ 目录的已知拓扑)**:
```json
{"available": false, "error": "ENOENT: ... ratchet-registry.json"}
```
- `available` (boolean, 必填): 来源——quality.js:/ratchet handler。
- `registry[].direction` (enum only_up|only_down, 必填 when available): 来源——scripts/ratchet-registry.json。
- 本回归当前拓扑实测 `available:false(ENOENT)`——属正确降级（PRD 边界情况 + [local-api-gate5] 铁律），smoke 对该拓扑放行。

---

## 已知约束（来自回归测试 + 累积 FR）

- [attempt-runner.test.cjs] → `bundle 与 request 的 runtime_resources 不一致（node_deps 缺一侧）→ mismatch 拒绝`（:1279）
- [attempt-runner.test.cjs] → `F10：bundle 与 request 的 runtime_resources 键序不同不算 mismatch`（:1348，按值非按键序）
- [attempt-runner.test.cjs] → `runtime_resources 带未知字段 → attempt_runtime_requirements_invalid`（:1296）
- [attempt-resources.test.cjs] → server-owned postgres 授权、exact runtime owner 校验（attempt_runtime_resource_owner_mismatch）
- [ratchet-registry-smoke.sh] → GET /api/brain/quality/ratchet 200；available=true 时 registry≥5 条含 direction/source；available=false 仅 ENOENT 放行
- [累积FR] context-manifest: unavailable（journey_id=none，非路径 C journey 点火，优雅降级——本 line 暂无历史 FR）

---

## 历史约束三源（铁律 → INV 映射）

铁律清单逐条映射（每条 → INV 条目见 contract-dod.md，或此处 N/A）：

- [planner-branch] N/A：本 sprint 不触及 planner 分支停靠逻辑。
- [generator-brain-url] N/A：不改 HARNESS_BRAIN_URL 注入；本 sprint 只固化 runtime resource + 角色发布边界。
- [validation-clock] N/A：不建/改 validation clock。
- [local-api-gate5] → **INV-1**（合同预声明「验证真相形态=local_api 无 UI」，对 judge 机械闸⑤放行，见下「验证真相形态声明」）。
- [progress-untracked] → **INV-2**（本 sprint PR 不得带入 `.harness/progress.md`）。
- [smoke铁律] → **INV-3**（新 smoke 登记进三档分类 + smoke_pool only_up，只增不减，每次 CI 都跑）。
- [deploy-preview-infra] N/A：Deploy Preview 既有 infra 故障不在本功能 PR 追修。
- [auto-merge竞态] N/A：Publisher 侧合并竞态非本合同覆盖（不扩权）。
- [vitest-exit] → **INV-4**（验证命令实跑确认 exit code 语义；node 断言全部显式 `process.exit(1)` 驱动，不依赖 vitest 对 include 范围外路径的 exit）。
- [canonical-immutable] N/A：本 sprint 改动文件（attempt-runner.cjs 断言锚点 / 新 smoke / ratchet-registry.json / smoke-allowlist.txt）经核对不在 canonical 不可变清单。
- [judge-evidence-window] N/A（evaluator 侧义务）：evaluator `.brain-result.json` 须把一手证据排前列。
- [judge-fail-triage] N/A（judge 侧义务）：FAIL 先分证据截断 vs 缺陷。

### 验证真相形态声明（[local-api-gate5] 硬放行）

本回归为 **local_api / 无 UI / 无真机** 形态：验证真相 = 「node 直调真实 attempt-runner.cjs 纯函数锚点收 exit code」+「bash 跑新 smoke 收 exit 0」+「curl GET /api/brain/quality/ratchet 台账（available:true 含 smoke_pool，或 available:false(ENOENT) 已知拓扑降级）」。**无浏览器截图、无真机 UIA**，judge 机械闸⑤（meta_verification_gap）对本合同放行。

---

## Golden Path

[Generator TaskBundle 派发] → [运行时授权 + 角色权限校验] → [本地已提交候选就绪] → [仅 Publisher 远端发布] → [新 smoke 永久接入 ratchet]

### Step 1: Generator 运行时授权——服务端拥有 PostgreSQL，caller false 不能降权
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + 边界情况第 1 条（caller postgres:false 而 server true 必须拒绝降权）。

**可观测行为**: server bundle 权威 `runtime_resources={postgres:true}` 与 caller request `{postgres:false}` 不一致 → fail-closed，抛 `attempt_runtime_requirements_mismatch`，不静默降级为无 DB 运行；等值匹配则返回服务端拥有的 `{postgres:true}`。

**验证命令**:
```bash
node -e 'const m=require("./packages/brain/scripts/fleet-worker/attempt-runner.cjs");try{m.__test__.resolveRuntimeRequirements({postgres:true},{postgres:false});console.error("FAIL: 降权未被拒");process.exit(1)}catch(e){e.message==="attempt_runtime_requirements_mismatch"?console.log("OK:"+e.message):(console.error("FAIL:"+e.message),process.exit(1))}'
# 期望：OK:attempt_runtime_requirements_mismatch
```
**硬阈值**: 降权抛 `attempt_runtime_requirements_mismatch`；等值匹配返回 `{postgres:true}`。

---

### Step 2: Generator = 本地已提交候选，无远端凭据（不能 push/建 PR/等 CI/merge）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条 + 边界情况第 2 条（Generator 不在 GITHUB_CREDENTIAL_ROLES，push 结构性阻断）。

**可观测行为**: `roleNeedsGitHubCredential('generator')===false`（无 GitHub 凭据路径）；`roleRetainsCandidate('generator',0)===true`（退出码 0 → 保留 `status=candidate`）。Generator 只产出本地已提交候选。

**验证命令**:
```bash
node -e 'const t=require("./packages/brain/scripts/fleet-worker/attempt-runner.cjs").__test__;const ok=t.roleNeedsGitHubCredential("generator")===false&&t.roleRetainsCandidate("generator",0)===true&&t.roleRetainsCandidate("generator",1)===false;ok?console.log("OK: generator=no-cred+candidate"):(console.error("FAIL"),process.exit(1))'
# 期望：OK: generator=no-cred+candidate
```
**硬阈值**: generator 无凭据（false）且仅退出码 0 保留候选。

---

### Step 3: Publisher = 唯一远端发布角色，接手 exact candidate
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 边界情况第 3 条（Publisher 收 candidate head sha 不一致→拒绝；唯一远端发布）。

**可观测行为**: `roleNeedsGitHubCredential('publisher')===true`（持远端凭据）；`roleIsRemotePublisher('publisher')===true` 且 `('generator')===false`。永久回归测试另在 attempt-runner.test.cjs 用真实 in-memory stateStore 驱动 `createAttemptRunner`，断言 `releaseSourceCandidate` 只对 `source.role==='generator'`、run_id/worker 一致、`status==='candidate'` 的 exact candidate 生效（非 exact→不释放）。

**验证命令**:
```bash
node -e 'const t=require("./packages/brain/scripts/fleet-worker/attempt-runner.cjs").__test__;const ok=t.roleNeedsGitHubCredential("publisher")===true&&t.roleIsRemotePublisher("publisher")===true&&t.roleIsRemotePublisher("generator")===false;ok?console.log("OK: publisher=cred+sole-publisher"):(console.error("FAIL"),process.exit(1))'
# 期望：OK: publisher=cred+sole-publisher
```
**硬阈值**: publisher 持凭据（true）且为唯一远端发布角色；generator 非发布角色。

---

### Step 4: 新 smoke 可跑通并永久接入 smoke ratchet
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（新 smoke 覆盖上述边界 + 永久登记进 ratchet 台账 + CI 跑道，只增不减）。

**可观测行为**: `bash packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh` exit 0（内部真实执行 Step 1-3 的 node 锚点断言 + 校验 ratchet 台账端点）；smoke basename 已登记进 `packages/quality/smoke-allowlist.txt`（失败即 CI 红）；`scripts/ratchet-registry.json` 的 `smoke_pool.watermark` 已 bump 到实际 `.sh` 计数（only_up，`find packages/brain/scripts/smoke -name '*.sh' | wc -l` ≥ watermark）。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh
# 期望：exit 0，末行 ✅ generator-publisher-runtime-boundary smoke 通过
```
**硬阈值**: smoke exit 0；smoke ∈ allowlist；smoke_pool.watermark == 实际 smoke .sh 数。

---

## 真实调用方请求 shape

N/A —— 本 sprint 无「设备/agent 调服务端」的真实外部调用方。被固化的是 fleet-worker **进程内**运行时授权与角色权限判定（`taskExecutionContract` / `GITHUB_CREDENTIAL_ROLES` / 候选生命周期），调用方是 attempt-runner 自身流水线，无 header/body 认证分叉面。

## 未覆盖真实链路清单

（本合同无第三方 API、无 `force_*`/stub/假数据；boundary 断言全部直调真实 attempt-runner.cjs 纯函数，永久候选生命周期测试用真实 in-memory stateStore。N/A）

## 禁 mock 边清单

本单涉及**状态机 + 生命周期钩子 + 跨模块数据传递**（Generator 候选保留 → stateStore → Publisher 取 source candidate），按 v9.12 硬规则禁 mock 被改的边：

- 代码 ↔ attempt-runner 纯函数锚点（`resolveRuntimeRequirements` / `roleNeedsGitHubCredential` / `roleRetainsCandidate` / `roleIsRemotePublisher`）：smoke 与 sprint/永久测试**直调真实导出**，禁 `vi.mock` / stub 顶替其返回值。
- 代码 ↔ attempt state store（Generator `status=candidate` 保留 与 Publisher `releaseSourceCandidate` 的状态迁移）：attempt-runner.test.cjs 永久回归测试必须用真实 `createAttemptRunner` + 模块自带的**真实 in-memory stateStore**（现有测试双身，非 mock 顶替 status），禁 stub 掉候选状态迁移这条边。
- 仅允许 mock 更外层无关依赖（docker adapter、workspaceManager 的文件系统副作用）——它们不是本单被改的边（本单不改流水线，只补断言锚点）。

> 本 sprint runtime_resources.postgres=false（无 DB），boundary 逻辑为进程内纯函数 + in-memory state store，无需真 Postgres；exact-candidate 生命周期在 in-memory stateStore 上真迁移即满足禁 mock 边要求。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 固化两条权限边界（①Generator 必获服务端 postgres runtime、caller false 不降权；②Generator=本地候选、Publisher=唯一远端发布）为可执行 smoke + 永久 ratchet 护栏 |
| **NFR（做得多好）** | 非功能 | 只增不减、每次 CI 都跑；不扩大任何角色凭据/权限集合；fail-closed 且有可机检报错标识 |
| **Invariant（永不违反）** | 不变量 | `generator ∉ GITHUB_CREDENTIAL_ROLES`；caller 不能把 server `postgres:true` 降为 `false`；`smoke_pool` only_up |
| **判定点（怎么知道）** | 判断假设 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | 无过期——回归护栏长期在库；GITHUB_CREDENTIAL_ROLES 定义变更时须同步更新锚点与测试 |
| **死亡告警（停了谁知道）** | 告警 | smoke 失败 → run-smoke-ratchet 基线 FAIL → CI 红（brain-ci）；smoke 被删/降级 → smoke_pool only_up ratchet-guard 红 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明（fail-closed：授权不一致=拒绝，不放行） |
| **效果确认（已发≠已生效）** | 回执 | smoke exit 0 + 台账端点 200 + smoke_pool.watermark==实际计数；最终 real-harness 全链 PR/CI 绿 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ caller 请求是否构成运行时降权 | A. `stableJson(input)!==stableJson(request)` 值比较; B. 只比 `postgres` 单字段 | A（值比较，presence+值） | 现有 F10 实现：两侧独立构造键序不定，须按值比较；单字段比会漏 node_deps 分叉 | 静默放行降权 → Generator 无 DB 运行、副作用漏验（面客/数据一致性） |
| ⚠️ 某角色是否允许持远端凭据 push | A. `role ∈ GITHUB_CREDENTIAL_ROLES` 集合成员; B. 按 provider 猜 | A（集合成员，字面） | 凭据注入门现以集合成员判定；扩集合=扩权，须显式 | 误把 generator 纳入 → Generator 可 push，越权发布 |
| candidate 是否 exact（可被 Publisher 接手） | A. `source.role==='generator' && run_id/worker/status 全等 && head sha 一致`; B. 只比 attempt_id | A（多字段全等） | releaseSourceCandidate 现有多字段校验，防错释放 | 释放错候选 → 发布非本次产物 |

> ⚠️ 判定点属「误判后果严重（静默放行/越权/面客）」级；PrepPRD/对齐会未逐条拍板，见 contract-dod.md notes `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| runtime_resources input/request 不一致 | 抛 `attempt_runtime_requirements_mismatch`，不 provision、不降级为无 DB | 是（纯函数，同输入同结果） | 无降级——fail-closed 拒绝 |
| runtime_resources 字段非法 | 抛 `attempt_runtime_requirements_invalid` | 是 | 无降级——拒绝 |
| ratchet 端点容器无 scripts/ 目录 | 端点返回 `available:false(ENOENT)`，HTTP 200 | 是 | 已知拓扑降级，smoke 放行（不 fail-closed，属正确降级） |
| smoke 未登记三档分类 | run-smoke-ratchet 报 UNREGISTERED → CI 红 | 是 | 无降级——新债不许欠 |

### 输入对抗面

N/A —— 本 sprint 非对外暴露 agent（fleet-worker 进程内运行时授权/角色判定，无外部用户可写入面，无 prompt injection 面）。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveRuntimeRequirements({postgres:true},{postgres:"false"})` / `({postgres:true}, undefined)`（presence 单侧缺）/ `({postgres:true},{postgres:false,extra:1})` → 应分别抛 invalid 或 mismatch，禁静默返回。
- 重复提交: 同一 attempt 连续两次 finalize（generator statusCode 0）→ 候选保留幂等，不重复释放 source。
- 中途中断: generator statusCode≠0（如 1）→ `roleRetainsCandidate` 应为 false，不保留候选。
- 边界值: `roleNeedsGitHubCredential('')` / `('Generator')`（大小写）/ 未知角色 → 应为 false（非白名单即无凭据），不得抛未处理异常。
发现分级: P0/P1（把 generator 判成有凭据 / 把降权判成放行）→ 阻塞 merge；P2/P3（报错文案）→ 记 findings 不阻塞。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
# Generator/Publisher 运行时权限边界 — local_api 全链验收（无 DB、无 UI、无真机）
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
RUNNER="./packages/brain/scripts/fleet-worker/attempt-runner.cjs"
SMOKE="packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh"
BRAIN="${BRAIN_URL:-http://localhost:5221}"

# 1. Step 1 — 运行时降权拒绝（server postgres:true, caller false → mismatch）
node -e 'const m=require(process.argv[1]);try{m.__test__.resolveRuntimeRequirements({postgres:true},{postgres:false});console.error("FAIL: 降权未拒");process.exit(1)}catch(e){e.message==="attempt_runtime_requirements_mismatch"?console.log("OK step1 mismatch"):(console.error("FAIL step1:"+e.message),process.exit(1))}' "$RUNNER"

# 2. Step 1 — 等值匹配返回服务端拥有的 postgres:true
node -e 'const m=require(process.argv[1]);const r=m.__test__.resolveRuntimeRequirements({postgres:true},{postgres:true});r&&r.postgres===true?console.log("OK step1 owned"):(console.error("FAIL step1 owned"),process.exit(1))' "$RUNNER"

# 3. Step 2 — Generator 无远端凭据 + 退出码 0 保留候选
node -e 'const t=require(process.argv[1]).__test__;(t.roleNeedsGitHubCredential("generator")===false&&t.roleRetainsCandidate("generator",0)===true&&t.roleRetainsCandidate("generator",1)===false)?console.log("OK step2 generator-local-candidate"):(console.error("FAIL step2"),process.exit(1))' "$RUNNER"

# 4. Step 3 — Publisher 持凭据 + 唯一远端发布角色
node -e 'const t=require(process.argv[1]).__test__;(t.roleNeedsGitHubCredential("publisher")===true&&t.roleIsRemotePublisher("publisher")===true&&t.roleIsRemotePublisher("generator")===false)?console.log("OK step3 publisher-sole"):(console.error("FAIL step3"),process.exit(1))' "$RUNNER"

# 5. Step 4 — 新 smoke 真实跑通（内部再跑 Step1-3 锚点 + 校验 ratchet 台账端点）
bash "$SMOKE"

# 6. Step 4 — smoke 永久登记：allowlist 含之 + smoke_pool.watermark == 实际 .sh 计数（only_up）
node -e '
const fs=require("fs");
const base="generator-publisher-runtime-boundary-smoke.sh";
const allow=fs.readFileSync("packages/quality/smoke-allowlist.txt","utf8").split(/\r?\n/).map(s=>s.trim());
if(!allow.includes(base)){console.error("FAIL: smoke 未登记进 smoke-allowlist.txt");process.exit(1)}
const reg=JSON.parse(fs.readFileSync("scripts/ratchet-registry.json","utf8"));
const sp=reg.find(e=>e.name==="smoke_pool");
if(!sp||sp.direction!=="only_up"){console.error("FAIL: smoke_pool 台账缺失/方向错");process.exit(1)}
const n=fs.readdirSync("packages/brain/scripts/smoke").filter(f=>f.endsWith(".sh")).length;
if(n<sp.watermark){console.error("FAIL: 实际 smoke 数 "+n+" < watermark "+sp.watermark+"（only_up 违约）");process.exit(1)}
if(sp.watermark<14){console.error("FAIL: watermark 未 bump（新增 smoke 后应 >=14，原 13）");process.exit(1)}
console.log("OK step4 ratchet-registered watermark="+sp.watermark+" actual="+n);
'

# 7. Step 4 — ratchet 台账端点回执（available:true 含 smoke_pool，或 available:false(ENOENT) 已知拓扑降级）
RESP="$(curl -sS -m 8 -w $'\n%{http_code}' "$BRAIN/api/brain/quality/ratchet")"
CODE="$(printf '%s' "$RESP" | tail -n1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"
[ "$CODE" = "200" ] || { echo "FAIL: ratchet HTTP $CODE"; exit 1; }
printf '%s' "$BODY" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.available===true){if(!(d.registry||[]).some(e=>e.name==="smoke_pool"&&e.direction==="only_up"&&e.source)){console.error("FAIL: 台账缺 smoke_pool");process.exit(1)}console.log("OK step4 endpoint smoke_pool")}else if(d.available===false&&/ENOENT/.test(d.error||"")){console.log("OK step4 endpoint available:false(ENOENT) 已知拓扑降级")}else{console.error("FAIL: 非预期 "+JSON.stringify(d));process.exit(1)}'

echo "✅ Golden Path 验证通过（Generator/Publisher 运行时权限边界回归）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（TDD Red） | `sprints/08160021-kernel-b7935480/tests/generator-publisher-boundary.test.ts` | `拒绝 caller 降权 postgres 至 false`；`等值匹配返回服务端拥有的 postgres:true`；`generator 为 false`；`publisher 为 true`；`仅 generator 且退出码 0 保留本地已提交候选`；`仅 publisher 为唯一远端发布角色` | 锚点未导出 → `TypeError: not a function` / `toThrow` 失败，6 it 全 RED |
| 永久回归护栏 | `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`（Generator 追加） | 同上四锚点 + `createAttemptRunner` 真 in-memory stateStore 驱动的 exact-candidate 生命周期 | 追加用例先红后绿 |
| 可执行 smoke | `packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh` | Step 1-4 real oracle | 文件不存在 → bash 报 No such file，RED |
