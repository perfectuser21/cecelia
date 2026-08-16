# Sprint Contract Draft (Round 1) — Fleet Runner run 级双容器

> 锚定父路声明: 独立小路（无父路）——journey e6f803f2 现有 golden_path 均为 planned 态（PRD 累积 FR 段确认），本 sprint 为 fleet-worker 基础设施改造，无已验收父路可挂。
> gp-anchor: skipped (product-map.json not found)
> contract-gate: 存在 packages/brain/src/lib/contract-gate.js（cecelia worktree），代码层 gate 生效，本合同按其惯用法起草。
> map: [MAP_NOT_CONFIGURED] — task.payload.map_repo=null（PRD 假设②），影响半径与 must_run_assertions 无源，scope 锚定沿用本 task 描述，不做领域猜测。

## Response Schema（推导来源: PRD 字面 / [NEW_PATTERN]）

本 sprint 无新增 HTTP 端点（改动是 fleet-worker 容器生命周期 + capacity 计量 + migration）。对外唯一可机检的结构是**新增 DB 列**与**新模块的纯函数返回**：

### 1. initiative_runs.container_id（新列，PRD 假设③首选列存）
```
container_id TEXT NULL   -- 工作容器名 cecelia-fleet-run-<run8>；同 run 所有 attempt 共享
```
- 来源: PRD 目标1「记录 container_id 到 initiative_runs（新列或 payload）」

### 2. run-container.cjs::resolveContainerTarget(...) 返回（[NEW_PATTERN]，本 sprint 新增纯函数契约）
```json
{"scope": "run|attempt", "name": "<string>", "reuse": <bool>, "clean": <bool>, "memMb": 2048, "cpus": 2}
```
- `scope` (string, 必填): `"run"`=工作容器（run 级复用）/`"attempt"`=评估容器或 fallback（attempt 级）
- `name` (string, 必填): 容器名，见下方命名规范
- `reuse` (bool, 必填): 同 run 后续 attempt 是否复用该容器（工作容器 true，评估容器/ fallback false）
- `clean` (bool, 必填): 是否必须干净新建不继承任何文件（评估容器 true，工作容器 false）
**禁用字段名**: `container_name`（用 `name`）、`isReuse`（用 `reuse`）、`runId`（返回体不回传入参）

### 3. capacity.js::computeRunContainerCapacity({...}) 返回
```json
<number>   // 并发 run 容器上限，5GB VM / 8 core → 2
```

---

## Golden Path

[run 首个 attempt 到达 fleet-worker] → [按 run_id 建/复用工作容器 + 记 container_id] → [同容器接力 Planner/Proposer/Reviewer/Generator，候选不丢] → [Generator 候选 bundle 落 quarantine] → [Evaluator 起干净 eval 容器从 bundle clone] → [run 终态销毁容器] → [一条 run 稳定 ≤2 容器]

### Step 1: run 首个 attempt 到达 → 建工作容器并记 container_id
**来源**: `[FROM_PRD]` — Golden Path 第 1 条（sprint-prd.md L18）

**可观测行为**: 到达一个无同 run_id 容器的 attempt（planner），fleet-worker 创建工作容器 `cecelia-fleet-run-<run8>`（label `cecelia.run_id=<run_id>`、非 root、零 cap、mem 2GB/cpu 2），`container_id` 写入 `initiative_runs`；容器名由 `resolveContainerTarget` 纯函数派生。

**验证命令**:
```bash
# 纯函数派生工作容器名（run 级）
node -e 'const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs"); const t=m.resolveContainerTarget({role:"planner",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"41457bc7-a28e-48a9-aa1d-eb052a151ee3"}); if(t.name!=="cecelia-fleet-run-e64c335a"||t.scope!=="run"||t.reuse!==true){console.error("FAIL",t);process.exit(1)}; console.log("OK",t.name)'
# 期望：OK cecelia-fleet-run-e64c335a
```
**硬阈值**: name === `cecelia-fleet-run-e64c335a`，scope===run，reuse===true
**验证命令（DB 列存在，evaluator 在 host 跑）**:
```bash
psql "${DB_URL:-postgresql://localhost/cecelia}" -tAc "SELECT to_regclass('initiative_runs') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='container_id')" | grep -qx t
```
**硬阈值**: container_id 列存在

---

### Step 2: 同 run 后续 attempt 复用同一工作容器（候选不丢）
**来源**: `[FROM_PRD]` — Golden Path 第 2 条（L19）

**可观测行为**: proposer/reviewer/generator 到达同 run → 复用同一工作容器（同 container_id），容器内起 fresh provider 进程（独立 TaskBundle/callback token/scoped route token/lease），共享工作区；Generator 本地候选提交不 push，留在工作区不蒸发。

**验证命令**:
```bash
node -e 'const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs"); const a=m.resolveContainerTarget({role:"proposer",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"aaaaaaaa-0000-4000-8000-000000000001"}); const b=m.resolveContainerTarget({role:"generator",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"bbbbbbbb-0000-4000-8000-000000000002"}); if(a.name!==b.name||a.name!=="cecelia-fleet-run-e64c335a"){console.error("FAIL diff container for same run",a,b);process.exit(1)}; console.log("OK same-run reuse")'
# 期望：OK same-run reuse（同 run 不同 attempt → 同一容器名）
```
**硬阈值**: 同 run 的 proposer 与 generator 得到相同 name；不同 run → 不同 name

---

### Step 3: Generator 候选 bundle 落 quarantine
**来源**: `[FROM_PRD]` — Golden Path 第 3 条（L20）

**可观测行为**: Generator 完成后候选 SHA 经 `git bundle` 落 host quarantine 卷（Brain 只读、只写一次、按 run 清理），工作区候选不 push（push 被 blocked-by-harness:// 拒绝）。

**验证命令**（单测，evaluator 跑；真 git bundle + 真文件系统，见禁 mock 边清单）:
```bash
node ./node_modules/.bin/vitest run sprints/08161915-kernel-3a812432/tests/eval-clean-clone.test.mjs --root . 2>&1 | tail -5
# 期望：Test Files 1 passed（bundle 产出 + 干净 clone 断言全绿）
```
**硬阈值**: vitest exit 0

---

### Step 4: Evaluator 起干净 eval 容器从 bundle clone（防污染）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条（L21）+ `[AI_ADDED]` 防污染标记文件断言（理由：#4890 防篡改依赖\"eval 容器不继承工作容器任何文件\"，需可机检的污染探针）

**可观测行为**: Evaluator attempt → 起全新容器 `cecelia-fleet-eval-<attempt8>`（clean=true、reuse=false），从 quarantine bundle 干净 clone 到候选 SHA（不 fetch 远端），HEAD==候选 SHA，容器内**不存在**工作容器写入的任何标记文件。

**验证命令**:
```bash
node -e 'const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs"); const t=m.resolveContainerTarget({role:"evaluator",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"41457bc7-a28e-48a9-aa1d-eb052a151ee3"}); if(t.name!=="cecelia-fleet-eval-41457bc7"||t.scope!=="attempt"||t.reuse!==false||t.clean!==true){console.error("FAIL",t);process.exit(1)}; console.log("OK",t.name)'
# 期望：OK cecelia-fleet-eval-41457bc7（评估容器 attempt 级 + clean）
```
**硬阈值**: name===`cecelia-fleet-eval-41457bc7`，scope===attempt，reuse===false，clean===true

---

### Step 5: run 终态销毁 + 容量 per-run 计量 + fallback
**来源**: `[FROM_PRD]` — Golden Path 第 5 条（L22）+ 边界（L26-28）

**可观测行为**: run 终态（done/failed/cancelled/orphan 判死）→ 销毁工作容器与残留 eval 容器，quarantine 按 run 清理；容量以并发 run 容器数计，5GB VM ≥2；`FLEET_RUN_SCOPED_CONTAINER=off` 回退单 attempt 容器；lease 过期/kernel 崩溃 → reconcile 按 run_id 找回同一容器。

**验证命令**:
```bash
node -e 'const c=require("./packages/brain/src/capacity.js"); const n=c.computeRunContainerCapacity({totalMemMb:5120,cpuCount:8}); if(!(n>=2)){console.error("FAIL capacity",n);process.exit(1)}; console.log("OK run-capacity",n)'
# 期望：OK run-capacity 2（≥2）
```
**硬阈值**: computeRunContainerCapacity(5120MB,8core) ≥ 2

**验证命令（fallback）**:
```bash
node -e 'const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs"); const t=m.resolveContainerTarget({role:"generator",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"41457bc7-a28e-48a9-aa1d-eb052a151ee3",runScoped:false}); if(t.scope!=="attempt"||t.reuse!==false||!t.name.startsWith("cecelia-fleet-")){console.error("FAIL fallback",t);process.exit(1)}; console.log("OK fallback",t.name)'
# 期望：OK fallback（off → attempt 级 legacy 命名）
```
**硬阈值**: runScoped=false → scope===attempt，reuse===false，legacy 全 attempt-id 命名

---

## 已知约束

### 来自回归测试（Step 1.2）
- `attempt-runner.test.cjs` → 现有信任断言：`GIT_CONFIG_VALUE_0: 'blocked-by-harness://evaluator'`（Generator push 拒绝）、callback token identity 不落盘、非 root / capability_snapshot 注入。本 sprint 不得破坏。
- `attempt-resources.test.cjs` → 私有网络 + pinned Postgres sidecar + ephemeral 凭据。改容器生命周期不得回退资源隔离。
- `workspace-manager.test.cjs` → clone/quarantine/verifyExpectedHead 现有行为；本 sprint 复用 `quarantine()` + `verifyExpectedHead()` 语义扩到 run 级。

### 累积 FR（Step 1.3 context-manifest）
- context-manifest: PRD 累积 FR 段声明「本 line 暂无已验收 ability（journey e6f803f2 golden_path 均 planned）」——无累积 FR 约束需继承。

### 铁律清单映射（Step 1.3 — 见下方 INV-N DoD 条目）
- 见 contract-dod.md `## Invariant 覆盖` 段，PRD Invariant 7 条逐条映射 INV-1..INV-7。

---

## 真实调用方请求 shape

本 sprint 无\"设备/外部 agent 调服务端\"新链路——attempt 到达仍走既有 fleet-worker admission（`validBearer` + attestation），认证方式不变（Bearer + HMAC attestation，见 fleet-worker.cjs `signAttestation`/`acceptedReceipt`）。改动只在容器命名/复用/销毁的**内部**决策，不新增外部调用方 shape。N/A（无新调用方边界）。

---

## 禁 mock 边清单

本单涉及**状态机**（attempt→容器生命周期迁移）、**跨模块数据传递**（run_id 决定容器复用）、**DB 写路径**（initiative_runs.container_id）、**生命周期钩子**（run 终态销毁 / reconcile 找回）。以下边禁 mock：

- **attempt-runner 状态机 ↔ run-container 决策模块**（本单新增 run_id→容器路由）：单测 `run-scoped-container.test.mjs` 直接调 `resolveContainerTarget` 真实纯函数，**不 mock** 决策逻辑（决策是被测核心，mock 即假绿）。
- **workspace-manager ↔ 真 git + 真文件系统 quarantine 卷**（本单新增候选 bundle + eval 干净 clone）：单测 `eval-clean-clone.test.mjs` 用真 `git bundle`/`git clone`/真 tmp 目录，**不 mock** git 与 fs；只 mock 更外层的 docker CLI（`runCommand`）——docker 是无法在单测内起真容器的外部边界，其真实性由 Final E2E `docker ps` 补验（L3）。
- **dispatcher/attempt-store ↔ 真 Postgres initiative_runs.container_id 写路径**（本单新增列写 + 同 run 共享读）：由 generator 补 `*.pg.integration.test.mjs`（brain-integration job 起真 Postgres 跑，**不 mock** pool），断言写入后同 run 第二 attempt 读到相同 container_id。合同要求该 PG 集成测试存在（见 contract-dod ARTIFACT-4）；Final E2E `psql harness_attempts` 再真验一次。
- 允许 mock 的外层无关依赖：docker CLI（`runCommand('docker',...)`）单测层可 fake（真实性 E2E 补）、通知渠道、远端 fetch。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | run 级工作容器（Planner/Proposer/Reviewer/Generator 共用、候选不丢）+ 每次评估一个干净 eval 容器（从候选 SHA 干净 clone）；container_id 记 initiative_runs；容量 per-run 计量；FLEET_RUN_SCOPED_CONTAINER fallback |
| **NFR（做得多好）** | | 每 run 容器 mem 2GB/cpu 2；5GB VM 并发 run 容器 ≥2；eval 容器零继承工作容器 node_modules/缓存/hooks/tmp |
| **Invariant（永不违反）** | | 非 root/零 cap、Generator push 拒绝、token 独立、Generator 禁自 merge、CI 基础设施禁改、Brain URL 服务端权威、planner 分支权威（PRD 7 条 → INV-1..7） |
| **判定点（怎么知道）** | | 见下方判定点登记表 |
| **保质期（何时过期）** | | quarantine bundle 按 run 清理（run 终态即退役）；container_id 随 run 终态置空/容器销毁；scoped token 随 attempt 进程退出回收 |
| **死亡告警（停了谁知道）** | | orphan-guard 判死触发销毁；reconcile 周期（fleet-worker `/reconcile`）按 run_id 找回，找不到活容器且 run 未终态 → 现有 reconcile 告警路径上报 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 容器建/销毁以 `docker ps`（Final E2E）+ initiative_runs.container_id（psql）双向确认；候选存活以 Evaluator 卡住时容器内可取候选确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ run 是否已终态（可安全销毁工作容器） | A. initiative_runs.phase in (done/failed/cancelled); B. orphan-guard lease 判死 | A + B（两者取或，任一判终态即销毁） | 单看 phase 漏 orphan；单看 lease 漏正常终态 | 过早销毁 → 候选/在跑 attempt 丢失（不可逆，直接面客 run 失败） |
| ⚠️ eval 容器是否被工作容器污染 | A. 检查标记探针文件不存在; B. 校验 clone 源仅 quarantine bundle 且 HEAD==候选 SHA | A + B | 单看 HEAD 漏依赖/符号链接污染（#4890） | 评估结果被污染 → 假绿放行坏候选（直接面客） |
| 同 run attempt 是否应复用容器 | A. run_id label 匹配活容器; B. attempt_id 匹配 | A（run_id） | 隔离粒度=run（决策 05585020） | 误按 attempt 隔离 → 容器爆炸回退旧痛点 |

> ⚠️ 两条判定点误判后果不可逆/直接面客。PrepPRD 决策 05585020 已由 Alex 拍板\"run 级隔离 + 保留 Generator→Evaluator 边界\"，销毁与防污染的**具体判定方法**未逐一拍过 → notes 标 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 工作容器创建失败 | attempt 不启动，标 attempt 失败，不留半建容器 | 是（幂等键=run_id，reconcile 复用已有） | reconcile 下一轮重试 |
| quarantine bundle 写失败 | Generator attempt 失败，候选留工作区（不 push），不进 Evaluator | 是（bundle 只写一次，已存在则复用） | 工作容器仍在，候选可人工取 |
| eval 容器 clone/防污染断言失败 | Evaluator 判 FAIL（不放行），不复用工作容器兜底 | 是（每次干净新建） | 记 frozen_baseline_guard 类错误，重启 eval attempt |
| reconcile 找不到活容器且 run 未终态 | 按 run_id 重建工作容器继续，不新建第二个 | 是（run_id 唯一） | 现有 reconcile 告警 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent 新入口（attempt 到达走既有 fleet-worker admission 鉴权，未新增外部可写接口）。

---

## E2E 验收

**journey_type**: agent_remote
**target_environment**: local_api

> 说明：单测（node/bash）本地执行；容器可观测（docker ps）与 psql harness_attempts 由 evaluator 在 fleet 宿主机 us-mac-m4 本地跑。docker 仅宿主机有，脚本对 docker 缺失做 L3 接缝守卫（缺 docker=环境未就绪=FAIL，不静默 SKIP）。身份用 Runner 注入的 HARNESS_* late-bound，不写死 UUID。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:=postgresql://localhost/cecelia}"
export DATABASE_URL="$DB_URL"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SPRINT_DIR="sprints/08161915-kernel-3a812432"

# ---- 层1: 纯函数 + 容量单测（node，环境无关逻辑断言）----
node ./node_modules/.bin/vitest run \
  "$SPRINT_DIR/tests/run-scoped-container.test.mjs" \
  "$SPRINT_DIR/tests/eval-clean-clone.test.mjs" \
  --root . 2>&1 | tail -20
echo "layer1 unit OK"

# ---- 层2: DB 列 + 同 run 共享 container_id（psql，真 Postgres）----
psql "$DB_URL" -tAc "SELECT to_regclass('initiative_runs') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='container_id')" | grep -qx t \
  || { echo "FAIL: initiative_runs.container_id 列缺失"; exit 1; }
# 同 run 的多 attempt 共享同一 container_id（若近 30 分钟有共享样本则强校验，无样本不阻塞）
SHARED=$(psql "$DB_URL" -tAc "SELECT count(*) FROM (SELECT run_id FROM harness_attempts WHERE container_id IS NOT NULL AND created_at > NOW() - interval '30 minutes' GROUP BY run_id HAVING count(DISTINCT container_id) > 1) x" | tr -d ' ')
[ "${SHARED:-0}" = "0" ] || { echo "FAIL: 同 run 出现多 container_id（隔离粒度回退到 attempt）"; exit 1; }
echo "layer2 db OK"

# ---- 层3: docker 容器计量（接缝，L3，缺 docker=环境未就绪=FAIL）----
command -v docker >/dev/null 2>&1 || { echo "FAIL: docker 不可用，fleet 宿主机预置未满足（环境未就绪，非 SKIP）"; exit 1; }
# 一条 run 稳定 ≤2 容器：每个 run8 前缀的 work 容器最多 1 个
DUP_WORK=$(docker ps --filter "name=cecelia-fleet-run-" --format '{{.Names}}' | sed -E 's/(cecelia-fleet-run-[a-f0-9]{8}).*/\1/' | sort | uniq -d | wc -l | tr -d ' ')
[ "$DUP_WORK" = "0" ] || { echo "FAIL: 同 run 出现多个工作容器"; exit 1; }
echo "layer3 docker OK"

echo "✅ Golden Path 验证通过（run 级双容器）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveContainerTarget` 传 role=未知值 / runId 非 UUID / attemptId 为空 → 应显式抛错，不得返回半成品容器名
- 重复提交: 同 run_id 并发两个 attempt 同时到达（竞态）→ 应只建一个工作容器（幂等键 run_id），不得双建
- 中途中断: 工作容器创建到一半 kernel 崩溃 → reconcile 必须按 run_id 找回，不留孤儿容器也不新建第二个
- 边界值: run 已终态后又来一个迟到 attempt → 不得复活已销毁容器；FLEET_RUN_SCOPED_CONTAINER 在 run 中途翻转 → 已建容器不受影响（读取时刻决策）
发现分级: P0/P1（候选丢失/eval 被污染/容器泄漏耗尽 5GB VM）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| run 级工作容器命名 + 同 run 复用 | `tests/run-scoped-container.test.mjs` | `work container name`、`same run reuses`、`different run different container` | → Cannot find module run-container.cjs（RED） |
| 评估容器干净 + fallback + 容量 | `tests/eval-clean-clone.test.mjs` | `eval container is attempt-scoped and clean`、`fallback off uses attempt scope`、`run capacity is at least 2` | → RED（模块/函数缺失） |
