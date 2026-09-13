# orchestrator 进程远程化 + 机器角色模型 — 设计

task: 7c95ef71-d566-4782-a841-3be038328276
决策: 2e756506（方案B）/ 96054a8b（invariant 纯调度器）/ ca6bf8e7（invariant 引擎-机器绑定）
判定点: e3a41ecc（闸语义）/ 0eef6860（判活）/ d3281fb0（回调）/ 854888a0（槽位）
归位: 工厂价值流 · 横切件（执行基座）· 动作类型=置换（承诺零变化的底层大手术）

## 1. 问题

Brain 派 harness 任务时，`launchKernelProcess` 用 `nodeSpawn(process.execPath, …)` 在
**Brain 自己所在的机器**上起 orchestrator 进程。Brain 搬到 us-vps 之后，这等于让调度器自己干活，
违反铁律 ca6bf8e7 —— 决策 96054a8b 的理由里已如此定性。

根因不是 CPU 而是**环境依赖**：orchestrator 需要完整 repo + skills SSOT + 凭据 + provider
账号目录，us-vps 上没有。靶子任务 feef7d3f 即死于 `loadSkillBundle: SKILL.md not found`。

同时，主理人 2026-09-13 给出机器演进事实：**10 月 Mac Studio（2TB/128GB）到货后成为主力 worker，
MMV 退位**。当前代码有 8 处 `us-mac-m4` 字面量，该字面量的真实语义是「主力机兼凭据权威」，
不是某台具体机器。不治理则迁移时一次性爆发。

## 2. 机器角色模型（本设计的地基）

引入机器可消费的角色枚举，取代散落的字面量：

| 角色 | 语义 | 现在 | 10 月后 |
|---|---|---|---|
| `scheduler` | 只调度不执行；内存小 | us-vps | us-vps |
| `primary` | 主力 worker：跑 orchestrator + 全 provider；**兼凭据权威** | us-mac-m4 (MMV) | **Mac Studio** |
| `secondary` | 次级 worker：只跑 Codex（ca6bf8e7 约束） | xian-mac-m4 / xian-mac-m1 | 同左 + 西安小机器 |

**单一事实来源** = `SERVERS`（infra-status.js）中每条新增 `machineRole` 字段。其余全部派生：

- `COMPUTE_SERVERS` ← 派生自 `machineRole ∈ {primary, secondary}`
- `CANONICAL_MACHINE_IDS` ← 派生自同一集合
- `DEFAULT_LOCAL_MACHINE_ID` ← 由 `resolvePrimaryWorkerId()` 解析 `machineRole === 'primary'`
- credential broker 的权威判据 ← `isPrimaryWorker(id)` 取代 `id !== 'us-mac-m4'`

迁移 MMV→Mac Studio 于是收敛为：机器清单加一条 + 把 `machineRole: 'primary'` 从 MMV 挪到
Mac Studio。**代码零改动。**

> 硬规矩：本次新增的任何代码不得出现 `us-mac-m4` 字面量，一律走角色解析。

## 3. 架构

```
Brain (us-vps, machineRole=scheduler)
  launchKernelProcess
    ├─ 闸: CECELIA_LOCAL_EXECUTION_ENABLED=false → 不本机起，改走远程   [判定点 e3a41ecc]
    ├─ 解析 primary worker（角色，非字面量）→ 得 bridgeUrl
    └─ POST {bridgeUrl}/harness/orchestrators/prepare → …/start
                          ↓
fleet-worker (primary, 现 MMV)
  orchestrator-runner（新增，与 attempt-runner 并列）
    ├─ prepare: 复用 prepareVerifiedWorkspace(workspace_spec) 备 worktree
    │           + 沿用 credential-envelope / github-credential-envelope
    └─ start  : 在宿主 spawn `node orchestrator/run.js`（detached），回执带 pid + host
                          ↓
orchestrator (primary 宿主上的裸进程)
    ├─ 每 90s writeHeartbeat → initiative_runs.orchestrator_{heartbeat_at,host,pid}
    ├─ 回调 Brain：直指 us-vps Tailscale（不再绕 MMV socat）            [判定点 d3281fb0]
    └─ 内部派 attempt → 本机 worker :5231 → attempt 容器（此段不变）

Brain 判活：只看 heartbeat 新鲜度（3min），不再要求 host 匹配 + kill(pid,0)  [判定点 0eef6860]
```

### 为什么 orchestrator 是裸进程而不是容器

attempt 的执行体是 docker 容器（attempt-runner.cjs:2007 `docker.prepare`）。orchestrator 不走
这条路，因为它**内部还要派 attempt 给同一台机器的 worker**，容器化需要额外打通「容器→宿主 5231」
与「容器→us-vps Brain」两条网络；而 attempt 容器是终端执行体、从不派新活，没有先例可循。
orchestrator 落在 primary 宿主上，正好拿到它本就需要的完整 repo / skills SSOT / provider 账号目录
——那些正是它在 us-vps 上起不来的原因。

隔离性权衡：orchestrator 是编排器，不执行不可信代码；真正跑代码的 attempt 仍在容器内。

## 4. 组件改动清单

### 4.1 远程化（4 处）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `harness-skill-relay.js` `launchKernelProcess` | 本机 nodeSpawn → 远程桥 prepare+start；闸语义反转 |
| 2 | `scripts/fleet-worker/fleet-worker.cjs` | 新增 `/harness/orchestrators/*` 路由（与 `/harness/attempts/*` 并列） |
| 3 | `scripts/fleet-worker/orchestrator-runner.cjs`（新建） | 长周期进程生命周期：prepare / start / inspect / terminal |
| 4 | `lib/kernel-liveness.js` | 判活改纯心跳新鲜度，去掉 host 匹配前置 |

### 4.2 角色模型（8 处硬编码治理）

| # | 文件 | 现状 | 改为 |
|---|---|---|---|
| 5 | `routes/infra-status.js` `SERVERS` | role 为中文描述 | 增 `machineRole` 枚举字段（单一事实来源） |
| 6 | `routes/infra-status.js` `COMPUTE_SERVERS` | 硬编码三台 | 派生自 machineRole |
| 7 | `orchestrator/preflight/canonical-machine-id.js` | 硬编码三台 | 派生自同一来源 |
| 8 | `orchestrator/production-transport.js:3` `DEFAULT_LOCAL_MACHINE_ID` | `'us-mac-m4'` | `resolvePrimaryWorkerId()` |
| 9 | `orchestrator/credential-broker.js:144` | `!== 'us-mac-m4'` | `!isPrimaryWorker(id)` |
| 10 | `orchestrator/github-credential-broker.js:36` | `!== 'us-mac-m4'` | `!isPrimaryWorker(id)` |
| 11 | compose `FLEET_WORKER_*_URL` | 每机一个 env | 保留（地址仍需配置），但 URL 解析按角色查表 |
| 12 | `task-router.js` `LOCATION_MAP` | `'us'`/`'xian'` 粗粒度 | 本刀只加注释标注语义债，**不改**（见范围边界） |

### 4.3 范围边界（明确不做）

- `LOCATION_MAP` 的 71 个 task_type 重新定向 —— 另立（交接单缺口 4）
- 方案 C 减层重构（loop.js 1979 + dispatcher.js 1742 + run.js 563）
- Mac Studio 实机接入（到货后按角色模型加一条清单即可）
- thalamus / rumination / conversation-consolidator 关停（主理人已表态不需要它们跑，另开）

### 4.4 槽位归属（判定点 854888a0，self-review 补）

orchestrator 与 attempt **必须各占独立槽位池**，不是偏好问题而是正确性问题：

orchestrator 是长周期进程，且它**内部还要派 attempt 给同一台 worker**。若二者共用一个并发池，
当池被 orchestrator 占满时，它们要派的 attempt 永远拿不到槽位 —— orchestrator 等 attempt、
attempt 等 orchestrator 释放槽位，**自锁**。并发越高越必然触发。

故：worker 侧 `orchestrator-runner` 维护独立于 `attempt-runner` 的并发上限；
两个池的水位分别上报，`fleet-resource-cache` 的 `effectiveSlots` 需区分两类，不得合并成一个数。

## 5. 数据流与错误处理

| 场景 | 行为 |
|---|---|
| primary worker 不可达 | **fail-closed**：拒派 + 落明确 reason_code，不装作成功（对治「失败不留原因」病） |
| prepare 失败 | 不建 run、不留半态；错误码透传到 task.error_message |
| start 失败 | 回滚 prepare 占用的 worktree/凭据 |
| orchestrator 心跳超 3min | 判死重拉（既有 watchdog 路径） |
| 心跳查询异常/字段缺失 | 沿用 fail-open → `unknown`（kernel-liveness 既有铁律，不得改成判死） |
| 凭据签发失败 | fail-closed，且错误必须区分「非权威机」与「凭据本身不可用」 |
| orchestrator 槽位耗尽 | 排队等待，**不得**挤占 attempt 池（否则自锁，见 4.4） |

写库并发：所有「SELECT 判态再 UPDATE」一律用 `UPDATE … WHERE`（铁律 761f242b）；
往 task.result 塞回执用固定子键（铁律 55f0d846，jsonb `||` 是浅合并）。

## 6. 测试策略

**档位：E2E + integration + unit 三档齐上**（改动碰真实跨机执行与凭据签发）。

| 层 | 内容 |
|---|---|
| GP 步骤断言 | `tests/gp/f1/step3-orchestrator-remote-launch.test.js` —— 真 import 被改模块，不 mock 它（lint-gp-anchor-artifact 硬闸要求） |
| 角色模型 unit | 角色派生正确性：改 machineRole 后 COMPUTE_SERVERS/CANONICAL/primary 解析同步变化 |
| 凭据回归 | **先写 failing test 锁住现有签发行为，再改 broker**；断言非 primary 机仍 fail-closed |
| worker 配置守卫 | `scripts/ci/__tests__/*.test.sh` —— 改坏 worker 地址/角色即报红 |
| smoke | `packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh`（须登记 smoke-allowlist.txt，否则棘轮闸红） |
| **proven-to-fire** | 手杀 primary 上的 orchestrator 进程，亲眼看 Brain 3 分钟内判死——没见它报红过不算守卫 |

## 7. 验收标准

- [ ] 真实 harness_initiative 端到端跑完，`initiative_runs.orchestrator_host` 实测为 primary 而非 us-vps
- [ ] us-vps 上 `ps` 查不到 orchestrator 进程
- [ ] 靶子 task feef7d3f 不再死于 `loadSkillBundle: SKILL.md not found`
- [ ] proven-to-fire：手杀 orchestrator → Brain 3 分钟内判死
- [ ] 闸仍拦本机执行（local-execution-guard-smoke.sh exit=0），但不再拦远程派发
- [ ] 全仓 `grep -rn "'us-mac-m4'" packages/brain/src` 在判断逻辑中零命中（仅机器清单数据行可有）
- [ ] 凭据签发在 primary 上仍成功；在非 primary 上仍 fail-closed
- [ ] CI 全绿

## 8. 实现顺序（风险控制）

凭据链是最危险的一环——改坏了所有远程派发 fail-closed。故顺序为：

1. 角色模型地基（SERVERS.machineRole + 派生函数 + unit test）
2. 远程化主干（worker 端点 + launchKernelProcess + 判活）
3. 闸语义反转
4. **最后**动两个 credential broker（先 failing test 锁住现有行为）
