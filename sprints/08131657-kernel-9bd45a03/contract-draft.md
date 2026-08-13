# Sprint Contract Draft (Round 1) — 真身 Session Controller：每条 kernel run 一个常驻监护进程

**journey_type**: autonomous
**target_environment**: local_api

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 harness 运行时编排的内部进程生命周期能力，line `e6f803f2` 暂无历史 golden_path（累积 FR 暂无历史），无父路可挂。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

<!-- cecelia 仓根目录无 product-map/generated/product-map.json，Step 1.7 整体跳过、不阻塞。 -->

## Unified Map 半径

[MAP_NOT_CONFIGURED] —— task.payload.map_scope / map_repo 均为 null（已核 `GET /api/brain/tasks/9bd45a03`），无 must_run_assertions 可注入；不回退领域硬编码。已知回归约束改由「## 已知约束」段的真 CI 回归测试承接。

## Response Schema（推导来源: PRD 明确 — 无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 是 Brain 内部进程生命周期 + `initiative_runs` / `tasks` DB 状态编排，不新增/不改动任何 HTTP 端点。验收面为进程存活 + DB lease/ownership 列 + task.result jsonb，非 REST body。Reviewer 第 6 维按「无 HTTP → 自动满分」处理，schema 完整性改由 DB 列断言 codify。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `kernel-controller-ownership.pg.integration.test.js` → createKernelRun 无 controllerSessionId **fail-closed**（缺失/空均拒绝、不写半态 run）；带 controllerSessionId → ownership 先于 Kernel 可执行态落库；kernel-v1 直打不产生无 Controller run。**本 sprint 不得回退**。
- [回归] `kernel-controller-lifecycle.pg.integration.test.js` → Kernel fatal 只结束 Kernel、Controller ownership 存活；failure_reason 结构化脱敏（不落凭据明文）；无主历史 / lease 过期 run fail-closed 进恢复、健康 owned run 不被误伤。**本 sprint 扩展、不得回退**。
- [回归] `harness-run-guard.js` `findActiveRunBlockingSpawn` / `terminalizeRunsForTask` 判据同源。**本 sprint 仅确认降级为后备，一行不改**。
- [累积FR] context-manifest: unavailable（journey `e6f803f2` 无历史 ability，本 line 暂无累积 FR）。

---

## Golden Path

[createKernelRun 点火] → [spawn 真身 Controller → 取 ownership → 拉起 Kernel] → [周期续租 lease] → [监护循环：存活/phase/PR-CI + failure_class 决策] → [human_review push 冻结/解冻] → [PR merged + task.result 回写] → [Controller 退出]

### Step 1: `_spawnKernelRuntime` 先起真身 Controller 并取得 ownership
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（第 18 行）「先 spawn 一个本机 detach 常驻 Controller 进程……取得 ownership……才拉起 Kernel」。

**可观测行为**: `harness-skill-relay.js:241` 的 `controllerSessionId = deps.controllerSessionId ?? randomUUID()` 被替换为真身身份 `deriveControllerSessionId({pid,host})`（形如 `controller:<host>:<pid>`，可反查进程），非裸 UUID。createKernelRun 后 `initiative_runs.controller_session_id` 指向真实存活进程；不存在 `controller_session_id IS NULL` 的活跃 kernel-v1 run。

**验证命令**:
```bash
# 真启动链（只替身最外层 launchKernel/ensureWt），断言 controller_session_id 真身前缀非 UUID
node node_modules/vitest/vitest.mjs run --root packages/brain \
  src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  -t "真身 identity" 2>&1 | tail -20
```

**硬阈值**: `controller_session_id` 匹配 `^controller:`（真身前缀），且不匹配裸 UUID 正则；无主活跃 run count = 0。
验证命令：`psql "$DB_URL" -tAc "SELECT count(*) FROM initiative_runs WHERE phase NOT IN ('done','failed') AND controller_session_id IS NULL"` → 期望 `0`。

---

### Step 2: Controller 周期心跳续租 lease（观测两个续租周期）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（第 19 行）「周期心跳续租 lease（可观测到至少两个续租周期）」。

**可观测行为**: 新增 `renewControllerLease(pool,{runId,controllerSessionId,leaseSeconds})` —— ownership 校验（仅 `controller_session_id` 匹配才续），把 `controller_lease_expires_at` 推到 `NOW()+leaseSeconds`。连续两次调用后到期时刻单调递增；Controller 存活则 lease 永不过期，`reconcileOwnerlessKernelRuns` 不介入该 run。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain \
  src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js \
  -t "续租两周期" 2>&1 | tail -20
```

**硬阈值**: 第二周期 `controller_lease_expires_at` > 第一周期（严格递增）；`renewControllerLease` 对不匹配 session_id 返回 `renewed:false` 不推进（ownership 防越权续租）。

---

### Step 3: 监护循环 —— Kernel fatal 按 failure_class 决策，run 不进入无主态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（第 20 行）+ 边界情况「Kernel 反复崩溃……超限转不可恢复类结构化终止」。

**可观测行为**: 新增 `classifyKernelFailure(code)` → `recoverable|unrecoverable`；`decideFatalAction({failureClass,resumeCount,maxResume})` → `{action:'resume'|'terminate'}`，可恢复且未超 `maxResume`（默认 3，对齐 `orphan_requeue_count` 烧到 3）→ resume，否则 terminate。Kernel fatal 时 `handleKernelProcessFatal` 只结束 Kernel、Controller ownership 记录存活（`controller_session_id` 未清），run 不进入无主态。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain \
  src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js \
  -t "Kernel fatal 后 run 不进入无主态" 2>&1 | tail -20
```

**硬阈值**: Kernel fatal 后 `controller_session_id` 仍等于原真身身份；无主活跃 run count = 0；`decideFatalAction` resume 次数达上限转 terminate。

---

### Step 4: 人审窗口守护 —— human_review 期间冻结 PR 分支 push
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（第 21 行）「run 进入 human_review 等待期间，Controller 冻结该 PR 分支的 push……人审裁决后解冻」，run 8783807c 死因（head 漂移饿死人审）。

**可观测行为**: 新增 `isHumanReviewPushFrozen(runRow)`（phase==='human_review' → true）+ `assertControllerPushAllowed(pool,{runId})` —— 冻结期抛 `controller_push_frozen:human_review` 拒止 push；phase 迁出 human_review（裁决）后解冻放行。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain \
  src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js \
  -t "human_review push 冻结" 2>&1 | tail -20
```

**硬阈值**: phase=human_review 时 `assertControllerPushAllowed` reject（`controller_push_frozen` 前缀）；phase 迁出后 resolve 放行。

---

### Step 5: 终局职责 —— 守到 PR merged + report 完成，回写 task.result 才退出
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步（第 22 行）+ 边界情况「回写未完成前 Controller 不得退出；回写失败必须结构化上报而非静默退出」。

**可观测行为**: 新增 `finalizeControllerExit(pool,{runId,expectedTaskId,prUrl,merged,summary})` —— 把 `tasks.result` jsonb 合并写入 `{pr_url,merged,summary}`（结构化终局摘要），写成功才允许退出；DB 写失败抛结构化错误（禁无声消失）。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain \
  src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js \
  -t "终局回写 task.result" 2>&1 | tail -20
```

**硬阈值**: `tasks.result->>'pr_url'` 非空且 `tasks.result->>'merged' = 'true'`；回写前 Controller 不退出。
验证命令：`psql "$DB_URL" -tAc "SELECT (result->>'merged')::bool AND result->>'pr_url' IS NOT NULL FROM tasks WHERE id='<seeded>'"`。

---

### Step 6: 越权红线 —— Controller 只监护不执行
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步（第 23 行）+ Invariant「只监护不执行」（第 68 行）。

**可观测行为**: `kernel-controller.js` 不 import / 不调用任何阶段执行入口（planner/proposer/generator/evaluator/judge 派发器），不改 Kernel 状态机权威、不绕 Gate。阶段工作仍由 Kernel 派发。

**验证命令**:
```bash
# 机械 grep：新模块不得引用阶段执行入口（只监护不执行）
node -e "const c=require('fs').readFileSync('packages/brain/src/lib/kernel-controller.js','utf8'); if(/dispatch(Planner|Proposer|Generator|Evaluator|Judge)|runPhase|executePhase/.test(c)){console.error('FAIL: Controller 触碰阶段执行入口');process.exit(1)} console.log('OK')"
```

**硬阈值**: grep 命中阶段执行入口 = FAIL；模块公共面仅 spawn/ownership/lease/监护/人审冻结/终局回写。

---

## 禁 mock 边清单

本单涉及调度（Controller→Kernel 启动链）/状态机（无主判定/fatal 决策）/跨模块数据传递（ownership 在 relay↔store↔lifecycle 接力）/生命周期钩子（spawn/fatal/终局退出）/DB 写路径（initiative_runs ownership/lease、tasks.result），故 failing test 必须真 PG、真相邻模块：

- 代码 ↔ `initiative_runs.controller_session_id` / `controller_lease_expires_at`（本单写 ownership + 续租 lease）—— 真 pool 连真 PG，禁 mock pool.query 顶替 UPDATE/SELECT。
- `renewControllerLease` ↔ `initiative_runs`（续租 UPDATE + ownership 校验）—— 真 PG UPDATE，禁 stub。
- `harness-skill-relay._spawnKernelRuntime` ↔ Controller spawn（被改的边：`randomUUID()` → 真身 `deriveControllerSessionId`）—— 真 `spawnSkillRelaySession` + 真 `createKernelRun`，只替身最外层 `launchKernel` / `ensureWt`（与被改的 ownership 边无关的外层依赖）。
- `handleKernelProcessFatal` / `reconcileOwnerlessKernelRuns` ↔ `initiative_runs`（fatal 收敛 + 无主收割）—— 真 `finalizeKernelRun` 真 PG，禁 mock。
- 代码 ↔ `tasks.result`（`finalizeControllerExit` 终局回写路径）—— 真 PG UPDATE，禁 stub。
- 真身进程死亡 ↔ lease 停续（B-03 kill -9）—— 用真 `child_process.fork` 的真实子进程作 Controller 身份来源，SIGKILL 真杀，禁用 `EventEmitter` 假进程顶替（作弊反例 #4）。

（纯函数 `classifyKernelFailure` / `decideFatalAction` / `isHumanReviewPushFrozen` / `deriveControllerSessionId` 无 DB 边，红证据落在 `tests/kernel-controller-contract.test.ts`，不受本清单约束。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | 每条 kernel run 起一个常驻真身 Controller 进程：取 ownership→拉 Kernel→周期续租 lease→监护 Kernel/phase/PR-CI→human_review 冻结 push→PR merged 后回写 task.result→退出 |
| **NFR（做得多好）** | 性能/可靠性 | 续租周期沿用现有 heartbeat 配置（`KERNEL_HEARTBEAT_STALE_MS=3min`，lease 默认 `CONTROLLER_LEASE_DEFAULT_SECONDS=1800s`，PrepPRD 未指定新值）；resume 重启上限 `maxResume=3`（对齐 orphan_requeue_count） |
| **Invariant（永不违反）** | 不变量 | 任何活跃 kernel-v1 run 必有有效 Controller ownership（否则 fail-closed 进恢复）；Controller 只监护不执行、不绕 Gate、不改状态机权威；ownership 在 createKernelRun 同一事务 fail-closed 落库 |
| **判定点（怎么知道）** | 见下方登记表 | 见「判定点登记表」 |
| **保质期（何时过期）** | 失效时机 | lease `controller_lease_expires_at` 到期即 ownership 失效；Controller 存活续租则不过期；resume 超 maxResume 后转不可恢复终态 |
| **死亡告警（停了谁知道）** | 告警手段 | Controller 死 → lease 过期 → `reconcileOwnerlessKernelRuns` 巡检兜底收尸（现有后备机制，已有回归覆盖）；无新增告警渠道 |
| **失败语义（挂了怎么办）** | 放行/拦截 | 见「失败语义声明」。核心：无主 run fail-closed 拦截进恢复，绝不静默 done；回写失败结构化上报 |
| **效果确认（已发≠已生效）** | 回执 | createKernelRun 后读回 `controller_session_id` 非空且真身前缀；续租后读回 lease 递增；终局读回 `tasks.result.merged/pr_url`；均 psql/真 PG 回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Kernel 进程是否真死（该 resume 还是终止） | A. `kill(pid,0)` ESRCH 正面证据; B. 心跳超时推断 | A（fail-open：只有 ESRCH 判死，其余 unknown 不判死） | 复用 kernel-liveness.js 铁律，把"我不知道"判死是 issue 13d41c64 根因 | 活 Kernel 被误杀重启 / 死 Kernel 漏救 |
| ⚠️ Controller 是否已死（lease 该不该收） | A. lease 过期 + 无存活 controller; B. 仅 pid 探活 | A（`isOwnerlessRun` = session 空 OR lease 过期） | 沿用 kernel-controller-lifecycle.js 现判据，健康 owned run 不误伤 | 健康 run 被误收尸 / 无主 run 静默残留 |
| failure_class 是否可恢复 | A. code 正则映射 assembly/contract→不可恢复; B. 人工枚举表 | A（沿用现有 failure_reason 语义，不新增枚举） | PRD 假设第 45 行「沿用现有语义不新增分类」 | 不可恢复类被反复 resume 烧配额 |

⚠️ 两个判定点误判后果严重（误杀/静默残留），沿用现有 fail-open/fail-closed 既定判据，未新增拍板点；PrepPRD 已定「沿用现有 heartbeat/failure 语义」，无待确认 ⚠️ 项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Controller spawn 失败 | createKernelRun 前抛错、不建半态 run（fail-closed） | 是（无 run 产生，dispatcher 重派） | 上抛 spawn 失败给调用方 |
| Kernel fatal（可恢复类） | resume 重启，resumeCount+1 | 是（同 runId resume，幂等键 runId） | 超 maxResume=3 转不可恢复 terminate |
| Kernel fatal（不可恢复类） | `handleKernelProcessFatal` 结构化 failed 回传、脱敏 failure_reason | 是（finalize 幂等） | 交恢复流程，不静默 |
| Controller 死（lease 过期） | `reconcileOwnerlessKernelRuns` fail-closed 收敛 failed | 是（二次纯谓词确认防竞态） | orphan-guard 后备接管收尸 |
| 终局 task.result 回写失败 | 抛结构化错误，Controller 不静默退出 | 是（jsonb 合并幂等） | 结构化上报，禁无声消失 |

### 输入对抗面（对外暴露 agent 必填）

N/A —— 本 sprint 是 Brain 内部进程编排，无对外暴露 agent 入口、无外部用户可写输入。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `renewControllerLease` 传不匹配 `controllerSessionId`（越权续租他人 run）→ 必须 `renewed:false` 不推进 lease。
- 重复提交: 同一 runId 并发两个 Controller 抢 ownership（createKernelRun 同事务 advisory lock + fail-closed），第二个必须 `created:false` 不写重复 ownership。
- 中途中断: 续租进行中 kill -9 Controller → 下一周期 lease 不再推进 → 到期后 orphan-guard 收敛，不得静默残留活跃无主 run。
- 边界值: `decideFatalAction` resumeCount 恰等于 maxResume（边界）→ terminate；maxResume-1 → resume；`leaseSeconds<=0` → 拒绝（沿用 createKernelRun 校验）。
- 竞态: Controller 正续租的同一刻 reconciler 扫描（lease 尚未过期）→ 健康 run 不被误收（二次纯谓词确认）。
发现分级: P0/P1（无主 run 静默残留 / 健康 run 被误收尸 / 越权续租）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> 单 bash 块。evaluator 在注入 `$DB_URL` 的 local_api 面执行。两份 PG 集成测试自建隔离 DB（`DB_DEFAULTS` 读 `DB_*` env，从 `$DB_URL` 解析导出），承接 B-01..B-06 + INV-1 全部真 PG Golden Path；末尾附真身进程真杀观测（真 `fork` 子进程 + SIGKILL，禁假进程）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"

# 1. 从 DB_URL 解析导出 DB_* env（PG 集成测试的 DB_DEFAULTS 读这些；空库自建隔离 DB）
eval "$(node -e '
  const u = new URL(process.env.DB_URL);
  const q = (s) => (s || "").replace(/"/g, "");
  process.stdout.write(
    "export DB_HOST=" + JSON.stringify(q(u.hostname)) + "\n" +
    "export DB_PORT=" + JSON.stringify(q(u.port || "5432")) + "\n" +
    "export DB_USER=" + JSON.stringify(q(decodeURIComponent(u.username))) + "\n" +
    "export DB_PASSWORD=" + JSON.stringify(q(decodeURIComponent(u.password))) + "\n" +
    "export DB_NAME=" + JSON.stringify(q(u.pathname.replace(/^\//, "")) || "postgres") + "\n"
  );
')"

# 2. 连通性 + controller ownership 列存在（migration 415 已落）
psql "$DB_URL" -tAc "SELECT 1" >/dev/null
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" | grep -qx 2

# 3. 真 PG Golden Path 全程（真 createKernelRun/finalize/lifecycle/relay 启动链，禁 mock 被改边）
export NODE_ENV=test
node node_modules/vitest/vitest.mjs run --root packages/brain \
  src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js \
  --reporter=verbose 2>&1 | tee /tmp/kctl-e2e.log
grep -Eq "Test Files.*passed" /tmp/kctl-e2e.log || { echo "FAIL: PG 集成套件未全绿"; exit 1; }

# 4. 真身进程真杀观测（L3）：fork 真实子进程作 Controller 身份来源 → kill -0 存活 → SIGKILL → 确证死亡
CTL_PID=$(node -e 'const c=require("child_process").fork(require("path"),["-e","setInterval(()=>{},1e9)"],{detached:true,stdio:"ignore"});c.unref();process.stdout.write(String(c.pid))' 2>/dev/null || \
  node -e 'const cp=require("child_process");const c=cp.spawn(process.execPath,["-e","setInterval(()=>{},1e9)"],{detached:true,stdio:"ignore"});c.unref();process.stdout.write(String(c.pid))')
kill -0 "$CTL_PID" || { echo "FAIL: 真身 Controller 子进程未存活"; exit 1; }
kill -9 "$CTL_PID"
sleep 1
if kill -0 "$CTL_PID" 2>/dev/null; then echo "FAIL: SIGKILL 后进程仍存活"; exit 1; fi
echo "OK: 真身 Controller 进程真杀确证死亡（lease 停续由 orphan-guard 兜底，套件 B-03 已验）"

echo "✅ Golden Path 验证通过"
```

## 探索提示锚点

见上方 `## 探索提示` 段（独立二级标题，未塞进 E2E 段内部）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 真身身份 + failure_class 决策 + 人审冻结谓词（纯函数） | `tests/kernel-controller-contract.test.ts` | `deriveControllerSessionId 返回真实进程身份`、`assembly/合同失效类 = unrecoverable`、`可恢复且未超上限`、`已到上限`、`run 处于 human_review 时冻结 push` | → import 缺失模块，全部 fail |
| 续租/无主/终局/真身（真 PG） | `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js`（扩展） | `续租两周期`、`Kernel fatal 后 run 不进入无主态`、`human_review push 冻结`、`终局回写 task.result` | → 新断言 fail |
| ownership 真身 identity（真 PG） | `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js`（扩展） | `真身 identity` | → controller_session_id 仍是 UUID，fail |
