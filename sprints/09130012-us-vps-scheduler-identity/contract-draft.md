# Sprint Contract Draft

**Sprint**: us-vps 纯调度器化第一刀 — 本机执行闸
**Journey type**: dev_pipeline（工厂 · F1 开发闭环，步骤 1「接单进车间即分档」）
**Target environment**: linux_server（us-vps）
**Branch**: cp-09130015-us-vps-scheduler-identity
**Task**: 216b050a-773d-4939-896e-0a1eef4b3eae
**Decisions**: 96054a8b（invariant）· ca6bf8e7（invariant）· 26c1e763（纠正，supersede 962281b2）

---

## 实际代码现状（改动前）

| 事实 | 证据 |
|---|---|
| 近 30 天 442 条 `orchestrator=skill-relay` 的活全在 us-vps 本机 spawn | `tasks` 表实测；`tasks.location` 近 30 天只有 `us` 一个值 |
| 本机 spawn 判据与机器身份**无关** | `harness-skill-relay.js` 对 `machineId`/`CECELIA_MACHINE_ID`/`machine` 的匹配行数 = **0**；唯一判据是 `payload.harness_runtime === 'kernel-v1'` |
| `production-transport.js` 那道 `localMachineId` 守卫是死代码 | 判据是入参且默认值即 `DEFAULT_LOCAL_MACHINE_ID`；`server.js:145`、`attempt-cleanup-worker.js:208` 等四个生产调用方全不传它 → `if` 恒为假 |
| `CECELIA_MACHINE_ID` 不能改 | `credential-broker.js:144`、`github-credential-broker.js:36` 硬编码 `controllerMachineId !== 'us-mac-m4'` 即 fail —— 这台 Brain 是凭据权威 |
| MMV worker 地址是不通的占位符 | compose 默认值 `host.docker.internal:5231`；实测 us-vps 的 `.env.docker` 从未定义该变量，故占位符一直是生效值 |

三台 fleet worker 状态（本 sprint 运维前置，已完成）：`us-mac-m4` ✅ 全绿 / `xian-mac-m4` ✅ 全绿 / `xian-mac-m1` ⚠️ docker 遗留（不阻塞）。

---

## Golden Path

[Brain 在 us-vps 上收到一个 harness 派发请求] → [闸识别本机执行已禁用] → [明确拒绝并给出原因，不建 run 不碰 worktree] → [`/health` 上能看到这台 Brain 的角色是 scheduler_only]

---

### Step 1: 本机执行禁用时，harness 派发被明确拒绝且不留半态

**可观测行为**: `CECELIA_LOCAL_EXECUTION_ENABLED=false` 时，任何 harness 派发（含 kernel-v1 与普通 skill-relay）返回 `{ok:false, error:'local_execution_disabled_on_scheduler'}`；`createKernelRun`／`ensureWt`／`launchKernel`／`spawnFn` 一个都不被调用。

**为什么必须"不留半态"**: 若拦晚了（在 `_spawnKernelRuntime` 内建完 run 才拒绝），会走进 `spawn 返回 pid 即算 ok` 的分支，结果是 run 记录建了、进程没了、错误只落 `kernel-<runId>.log`、任务静默卡到租约过期。

**验证命令**:
```bash
npx vitest run tests/gp/f1/step1-local-execution-guard.test.js
npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js
```

### Step 2: 缺省与显式 true 时行为零变化（防误杀执行机）

**可观测行为**: `CECELIA_LOCAL_EXECUTION_ENABLED` 未设置或 `='true'` 时，派发路径与改动前逐字节一致，闸不介入。

**验证命令**:
```bash
npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js -t "行为零变化"
```

### Step 3: 角色声明可观测（禁静默）

**可观测行为**: `/api/brain/health` 返回 `local_execution: {enabled, role, guard, reason}`；`enabled=false` 时 `role='scheduler_only'` 且 `reason` 非空；该字段**不**参与 healthy 判定（scheduler_only 是正常形态，让它 degraded 会使告警常红）。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/local-execution-guard-smoke.sh
```

### Step 4: 配置形态被守住（防回归）

**可观测行为**: 四条断言全绿——worker 地址不得退回占位符 / 执行闸在位且默认 false / **`CECELIA_MACHINE_ID` 必须仍是 `us-mac-m4`** / 闸必须读 `(deps.env ?? process.env)` 可注入形式。

**验证命令**:
```bash
bash scripts/ci/__tests__/us-vps-local-execution-disabled.test.sh
```

---

## 硬阈值（Final 验收）

| # | 断言 | 命令 | 状态 |
|---|---|---|---|
| 1 | GP 步骤断言 4/4 绿，且真 import 被改模块 | `npx vitest run tests/gp/f1/step1-local-execution-guard.test.js` | ✅ 4 passed |
| 2 | relay 单测全量绿（不破坏既有 preview-guard 等） | `npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js` | ✅ 55 passed |
| 3 | 配置守卫 proven-to-fire | 改坏 worker 地址 → 报红 → 还原 → 全绿 | ✅ 亲验 |
| 4 | GP 锚产物闸通过 | `bash .github/workflows/scripts/lint-gp-anchor-artifact.sh origin/main` | ✅ |
| 5 | smoke 闸通过 | `bash .github/workflows/scripts/lint-feature-has-smoke.sh origin/main` | ✅ |
| 6 | DevGate 三闸 | facts-check / check-version-sync / check-dod-mapping | ✅ |

---

## 不包含（另立）

- **skill-relay 远程化**（handoff 缺口 1，最大头）：`harness-skill-relay.js:149` 的 `launchKernelProcess()` 本机 spawn 改接 fleet transport，需设计 worktree 如何到远程机、凭据 broker、回调链路。**闸生效后 kernel-v1 任务在 us-vps 无法执行，所以这是紧接着的下一刀，不是可选项。**
- LOCATION_MAP 语义改造（缺口 4）：71 个 task_type 从 `'us'` 改成机器定向
- OpenClaw 并入同一台账（缺口 5，独立轨道）
- Notion 双向同步（凭据修复 + 派工字段推送）
- `xian-mac-m1` docker CLI 补齐
