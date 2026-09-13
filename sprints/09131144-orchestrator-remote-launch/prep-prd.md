# PrepPRD：orchestrator 进程远程化第一刀 — Brain 派任务时在 MMV 上启动 orchestrator

task_id: 7c95ef71-d566-4782-a841-3be038328276
决策依据: 2e756506（方案B拍板）/ 96054a8b（invariant 纯调度器）/ ca6bf8e7（invariant 引擎-机器绑定）
归位: 工厂价值流 · 横切件（执行基座，服务 F0/F1/F4）· 动作类型=置换

## 本次对话涵盖的所有事项（防信息丢失）

- [x] 本 PrepPRD 包含：launchKernelProcess 改走远程桥 / fleet-worker 加 orchestrator 端点 /
      判活机制适配 / 闸语义反转
- [x] **范围变更（2026-09-13 主理人拍板「一刀到位」）**：本刀同时清理 8 处 us-mac-m4 硬编码，
      建立机器角色模型（scheduler/primary/secondary）。动因：10 月 Mac Studio(2TB/128GB) 到货后
      MMV 退位成为主力 worker，字面量不治理则迁移时一次性爆发。详见
      docs/superpowers/specs/2026-09-13-orchestrator-remote-launch-design.md（该文档为本刀权威设计）
- [ ] 另立 Sprint（本次不做）：Codex 类任务泛化到西安 M1/M4（受 ca6bf8e7 约束，Claude 任务永不外派）
- [ ] 另立 Sprint（本次不做）：GP 199ae170 的步骤 A/C/E/F（Linux 部署脚本分支、host-disk cron、Bark 告警）
- [ ] 另立 Sprint（本次不做）：方案 C 减层重构（loop.js 1979 + dispatcher.js 1742 + run.js 563）

## 本次要做的

让 Brain 派 harness 任务时，在 MMV 上启动 orchestrator 进程，而不是在自己所在的 us-vps 上起。

这不是性能优化，是**修复对铁律 ca6bf8e7 的违反**——决策 96054a8b 的理由里已如此定性：
「Brain 自己对 golden_path_proposal 等 task_type 存在 kernel-v1 in-process 执行路径
（orchestrator/run.js 直接在 Brain 容器自己身上跑，不走 fleet worker），这本身就违反引擎-机器绑定铁律」。

根因澄清（推翻「CPU 压力」这一早期归因）：orchestrator 在 us-vps 跑不起来的主因是**环境依赖**——
它需要完整 repo + skills + 凭据 + provider 账号目录，us-vps 上没有。靶子任务 feef7d3f 即死于
`loadSkillBundle: SKILL.md not found`。

## Golden Path（单线性步骤序列）

1. Brain(us-vps) 收到 harness_initiative 任务 → 判定需远程执行 → 系统**不再本机 spawn**
2. Brain 经 fleet 桥向 MMV 请求准备工作区 → MMV 返回 job 受理回执 → 状态 prepared
3. Brain 请求启动 → MMV 起 orchestrator 进程 → 回执带 pid + host → 写入 initiative_runs
4. orchestrator 在 MMV 上跑编排循环，每 90s 打心跳 → Brain 凭**心跳新鲜度**判活（不再用跨主机裸 pid）
5. orchestrator 跑完回调 Brain → 任务终态落库 → 主理人看到 PR

**出错恢复**：
- MMV 不可达 / prepare 失败 → Brain 记录明确失败原因（禁静默），任务不被判成「神秘停摆」
- orchestrator 心跳超 3 分钟断 → 判死重拉

## 客户视角

主理人视角零变化：派任务、任务跑完、出 PR。唯一可感知的差别是 us-vps 不再因执行负载而过载，
且 harness 任务不再 100% 失败于 skill 加载。

## 涉及的组件

- packages/brain/src/harness-skill-relay.js（launchKernelProcess）
- packages/brain/scripts/fleet-worker/fleet-worker.cjs（新端点）
- packages/brain/src/lib/kernel-liveness.js（判活适配）
- packages/brain/src/orchestrator/heartbeat.js（心跳，已有三列 migration 312）

## GP-Anchor 声明

（本仓库无 product-map/generated/product-map.json，N/A —— gp-anchor: skipped, non-zenithjoy-workspace repo）
本仓库实际闸为 lint-gp-anchor-artifact，要求 tests/gp/<journey>/step<N>-*.test.js，已有 f1/g5 锚点目录。

## 判定点登记表（decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ P0-1 闸语义 | ①维持「一刀切拒绝派发」②改为「禁本机起，放行远程」 | ② | 闸的 reason 文案当初即按②写，实现未跟上 | ①会把远程派发一起拦掉，改完等于没改，且静默 |
| ⚠️ P0-4 判活机制 | ①继续 host+pid ②纯心跳新鲜度 ③经 worker inspect 远程探 | ②（主理人拍板） | heartbeat.js:5「跨主机裸 pid 无意义」；心跳 90s / 阈值 3min 已存在且与 watchdog 同源 | ①远程后 host 永不匹配→恒 fail-open unknown→进程死了也发现不了，任务永久挂着 |
| P0-2 回调地址 | ①保留绕 MMV socat ②直指 us-vps Tailscale | ②（主理人拍板） | 绕 MMV 是 Brain 搬迁遗留；orchestrator 搬到 MMV 后会变成「打自己再绕回去」 | 回调打不回 → orchestrator 干完活 Brain 不知道 |
| P0-3 worker 槽位 | ①共用 attempt 槽位 ②orchestrator 独立槽位 | 实现时定，倾向② | orchestrator 长周期、attempt 短周期 | ①长任务占满槽位饿死 attempt |
| 待验证 | attempt 的 prepare 能否复用于 orchestrator worktree 准备 | **必须实测，禁假设** | — | 假设成立而实际不成立 → worktree 没备好就起进程 |

## 已命中铁律（自动 enforce，无需拍板）

- 96054a8b — us-vps 纯调度器，禁本机跑真实任务
- ca6bf8e7 — 引擎-机器绑定：Claude Code 只在 MMV，西安 M1/M4 只跑 Codex，需 Claude 的任务一律路由本机
- 29e7d8f8 — 探针必须探真正要用的资源：健康探针要探「能起进程 / worktree 可写 / skills 可读」，
  不能只探 /health 身份端点
- 15e28dee — 同构警示：「PR 时代假设漏到本地候选流程」→ 本例为「本机执行假设漏到远程流程」，
  必须扫全所有假设 orchestrator 在本机的地方（日志路径 / worktree 路径 / pid 探活 / kernel-liveness）
- 761f242b — 「SELECT 判态再 UPDATE」幂等一律升级为 UPDATE ... WHERE
- 55f0d846 — jsonb || 是浅合并，往任务 result 塞回执要用固定子键

## 前置工作（已逐项确认，无 TBD）

- [x] MMV fleet-worker 100.71.151.105:5231 → HTTP 200
- [x] MMV 上 skills SSOT 在位：/Users/administrator/perfect21/zenithjoy-skills
- [x] KERNEL_FLEET_BRIDGE_TOKEN 已配（len=64）；/api/brain/health 的 fleet_transport 自述
      {enabled:true, status:ready, worker_machines:[us-mac-m4, xian-mac-m4, xian-mac-m1]}
- [x] initiative_runs 已有 orchestrator_host / orchestrator_pid / orchestrator_heartbeat_at
      三列（migration 312）
- [x] 靶子任务 feef7d3f-c08e-4ee1-acba-a6a4e626edf2 存在（golden_path_proposal，failed 态）

## 验收标准（置换动作 = 引用既有断言，绿→短暂红→绿）

- [ ] 一个真实 harness_initiative 任务端到端跑完，且 initiative_runs.orchestrator_host
      实测为 MMV 而非 us-vps
- [ ] us-vps 上 `ps` 查不到 orchestrator 进程（执行确实不在调度器上）
- [ ] 靶子 task feef7d3f 不再死于 loadSkillBundle: SKILL.md not found
- [ ] **proven-to-fire 守卫**：杀掉 MMV 上的 orchestrator 进程，Brain 能在 3 分钟内判死
      （证明判活没退化成恒 unknown）——必须亲眼看它报红一次
- [ ] 闸仍拦本机执行（local-execution-guard-smoke.sh 保持 exit=0），但不再拦远程派发
- [ ] CI 全绿

## 不包含

- Codex 任务泛化到西安 M1/M4（ca6bf8e7 约束，另立）
- 方案 C 减层重构（另议）
- Anthropic 余额充值 / thalamus / rumination / conversation-consolidator 关停（主理人已表态不需要它们跑，另开）
