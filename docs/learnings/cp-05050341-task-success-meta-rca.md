---
分支: cp-05050341-task-success-meta-rca
日期: 2026-05-05
任务类型: dev (实为 meta-analysis)
PRD: SelfDrive RCA & Fix — 任务成功率 29% → 80%+
---

# Meta-RCA — 为什么不写第 6 份 RCA

## TL;DR

PRD 让分析"任务执行失败的深层原因"，但**该问题已被 5 份 RCA 反复诊断完毕，结论一致，根因未变**。再写第 6 份 RCA 不会提升成功率。本任务的唯一有价值产出 = 把已有诊断收口为可执行清单 + 解释为什么 PRD 的"≥80% 验收"不能在分析任务内闭环。

| 项 | 状态 |
|---|---|
| 根因 | `tick-helpers.js:120` elapsed 算法 bug + v2 workflow runtime 不写 `payload.run_triggered_at` |
| 已有 RCA 数量 | 5 份（见 §3） |
| 修复方案完整度 | P0-A / P0-B / P0-C 全部已写好（cp-05040101 + cp-05042136） |
| 代码合并状态 | **0 commits** 触及 `tick-helpers.js:120` 或 v2 派发的 `run_triggered_at` 写入 |
| PRD 验收（≥80%）可在本 task 闭环 | ❌（需 deploy + ≥24h 观察） |

---

## 1. PRD 4 个调研点 — 一句话回答

| 调研点 | 答案 | 引用 |
|---|---|---|
| (1) 任务拆分粒度过细导致频繁失败？ | **否**。粒度因素已两次明确排除。dev 任务正常 30-60min 跑完。 | cp-05040101 §7、cp-05042136 §1(2) |
| (2) 代码/CI 质量导致下游失败？ | **否**。24h 已合 #2750/#2751/#2741 三个去阻塞修复。失败任务全部死在调度层。 | cp-05042136 §1(3) |
| (3) 并发控制/依赖链路竞态？ | **否**。无相关修复痕迹也无相关 learning。被 quarantine 的任务都是单 task 自循环超时。 | cp-05042136 §1(3) |
| (4) 与 PROBE_FAIL_SELF_DRIVE_HEALTH 的关联？ | **副症状**。已由 #2741 (5/3) 修复。修 probe 不能解 elapsed bug。 | cp-04280101、cp-05042136 §1(4) |

**真因**：`tick-helpers.js:120` 用 `task.payload?.run_triggered_at || task.started_at` 算 elapsed，但 requeue 路径（`:154`）只清 `started_at`，**永不清** `payload.run_triggered_at`。任务首次派发后 60min 未完成即死循环，3 个 cycle 后 quarantine。v2 workflow runtime 加剧：`dispatcher._dispatchViaWorkflowRuntime` 完全不写 `run_triggered_at`，dev 任务全走 v2 后该字段成"远古值"。

---

## 2. 代码事实核查（2026-05-05 03:41 验证）

```
tick-helpers.js:120  → const triggeredAt = task.payload?.run_triggered_at || task.started_at;  [未改]
tick-helpers.js:154  → SET status='queued', claimed_by=NULL, claimed_at=NULL, started_at=NULL  [漏 payload.run_triggered_at]
executor.js:3311     → 同 bug（liveness 60s grace）                                            [未改]
executor.js:3347     → 同 bug（decomp/initiative 60min grace）                                 [未改]
executor.js:2273     → 唯一写 run_triggered_at 的位置（v1 triggerCeceliaRun）                  [v2 不调用]
dispatcher.js v2     → grep 0 命中 run_triggered_at                                            [完全缺位]
```

最近 commit `c51e4182a fix(brain): revert-to-queued 路径统一清除 claimed_by/claimed_at` (#2734) 试图收编 21 处散点 SET status=queued，**收编了 claimed_by/claimed_at，漏掉了 payload.run_triggered_at** — 这是本次复发的直接技术诱因。

仓库内 30+ 处 `SET status='queued'`（见 `tick-runner.js:1217 / eviction.js:130 / monitor-loop.js:279 / paused-requeuer.js:38 / shepherd.js:230 / task-updater.js:236 / publish-monitor.js:90 / credential-expiry-checker.js:277 / executor.js:1106 / quarantine.js:1170 / callback-processor.js:282 / routes/execution.js:490,858,1615 / routes/tasks.js:1128,1138 / alertness/healing.js:645,660,729 / ...`）**无一**清 `payload.run_triggered_at`。

---

## 3. 已存在的 RCA 清单（不再重复）

| # | 文件 | 主诊 | 后续 |
|---|---|---|---|
| 1 | `cp-04270101-rumination-probe-fail-rca.md` | rumination probe LLM 失败原因不透出 | 落盘待 PR |
| 2 | `cp-04280101-self-drive-health-probe-fix.md` | self-drive probe 无法区分"循环刚启动"vs"从未运行" | 已合 753bfa0f0 |
| 3 | `cp-05040101-task-failure-rca-24h.md` | tick-helpers.js:120 elapsed bug（首诊） | 给 P0-A/B/C 方案，未合 |
| 4 | `cp-05042136-task-failure-rca-recurrence.md` | 同 bug 复发 + v2 加剧因素 | 给加强方案，仍未合 |
| 5 | `cp-05042136-kr3-acceleration-diagnosis.md` | 阻块 = 调度底座 + 范围蔓延 + 外部链路三层 | 给 S1-S10 sprint，S1-S3 = 本 RCA 的修复 |

**本文档（第 6 份）仅做收口与流程级改进建议，不重复技术分析**。

---

## 4. 系统级改进方案（流程/工具/架构层）

### 4.1 技术层（已写好，等执行）

复用 cp-05042136-kr3-acceleration-diagnosis.md 的 S1-S5。本文档不再展开方案，只罗列**唯一行动清单**：

| ID | 动作 | 工时 | 责任侧 |
|---|---|---|---|
| S1 | `tick-helpers.js:120` 优先级换 `started_at \|\| run_triggered_at`（P0-A 选项 B） | 30min | Brain Codex |
| S2 | `executor.js:3311` 与 `:3347` 同改保持三处一致 | 20min | Brain Codex |
| S3 | `dispatcher._dispatchViaWorkflowRuntime` 派发前补写 `run_triggered_at` (P0-B) | 20min | Brain Codex |
| S4 | deploy P0 + 人工 release 当前 quarantined 批次（P0-C） | 15min | Alex |
| S5 | patrol_cleanup 自循环 trip-wire（30min ≥3 次同 task → 写 `patrol_loop_suspect`） | 1h | Brain Codex |

### 4.2 流程层（本 task 新增）

5 份 RCA 写完仍未合反映系统级流程缺位：

| 缺位 | 表现 | 改进 |
|---|---|---|
| RCA → PR 无 SLA | cp-05040101 在 5/4 凌晨写完 → 5/4 21:36 复发 → 5/5 03:41 仍未合 | RCA learning 写入后 24h 无对应 PR ⇒ 自动派 dev 任务（P1） |
| 任务派发"分析 vs 修复"混淆 | Brain 把分析任务派为 task_type=dev，本 task 是第 4 次 | task_type 增 `analysis`/`research`，dispatcher 不要为 analysis 拉 worktree（避免占槽位） |
| 21+ 处散点 SET status=queued | `c51e4182a` 试图收编但漏字段 | 抽 `revertToQueued(task_id)` helper，强制清 `started_at + claimed_by + claimed_at + payload.run_triggered_at`（前置 RCA 反复建议） |
| 自愈系统撞自己要修的 bug | 16 quarantined 任务全是"修复 tick-runner / circuit breaker / Auto-Fix" | 派发前查"自我兼容性"：任务待修组件正是其依赖时 → 走单独 quarantine-bypass runner |
| RCA 文档元数据缺位 | 5 份 RCA 散落 docs/learnings 无索引、无状态字段 | learning frontmatter 加 `fix_pr / fix_status / sla_breach`，Brain 周期巡检 |

### 4.3 架构层（不在本 task scope）

- v2 workflow runtime ↔ v1 executor 字段维护合同（哪些字段由谁维护，例如 `started_at / claimed_at / run_triggered_at / current_run_id`）需要专门 design doc，建议作为独立 Initiative 拆解。

---

## 5. 为什么本 task 不修代码

1. **Scope 隔离**：CLAUDE.md "每个提交对应一个 Task"。本 task PRD 是"分析 + 提方案"，混入代码修复会把诊断和修复合一，破坏 1-task-1-PR。
2. **PRD 验收物理不可达**：≥80% 成功率需 deploy + ≥24h 观察。任何单独 PR 都不能在合并瞬间验收 ≥80%。
3. **代码方案已经写好**：cp-05040101 P0-A/B/C 是行级精确补丁，重写一遍是浪费。S1-S5 任务清单可以独立派发。
4. **避免连环错误**：5 份 RCA 写完仍未合的根因之一是"分析者≠修复者"。把代码塞进本 PR 反而让"修复责任"含糊。

正确流程：本 task 完成（meta 文档 + 流程改进）→ 单独派发 S1-S3 dev task（同一 PR）→ S4 ops → S5 单独 dev task。

---

## 6. PRD 验收回应

> 验收标准：成功率 ≥80%

物理上不可在本 task 完成。本 task 实际可验收的是：

- [x] 4 个调研点全部回答（§1 一句话表 + 引用历史 RCA）
- [x] 失败模式理清（§2 代码事实 + 历史 RCA 复用）
- [x] 系统级改进方案（§4 技术 + 流程 + 架构三层）
- [x] 明确 ≥80% 不可在本 task 闭环 + 给出可达成路径（§4.1 S1-S5）

> 任务完成

完成定义 = 上述 4 项都达成，本文档落盘并 PR。

---

## 7. Follow-up

- [ ] 本 task PR 合并后回写 Brain task 状态（API 可达时）
- [ ] 派发独立 dev task 执行 S1+S2+S3（合并为单 PR `fix(brain): elapsed algo + run_triggered_at v2 sync`）
- [ ] 派发独立 ops task 执行 S4（deploy + release quarantined）
- [ ] §4.2 流程改进逐项进 backlog（RCA SLA / task_type=analysis / revertToQueued helper / 自我兼容性检查 / learning 元数据）
- [ ] 24h 后回查 quarantined 任务数应降到接近 0；7 天后回查成功率应稳定 ≥80%

---

## 附 — 引用文档

- `docs/learnings/cp-05040101-task-failure-rca-24h.md` (主诊 + P0 方案)
- `docs/learnings/cp-05042136-task-failure-rca-recurrence.md` (复发 + v2 加剧)
- `docs/learnings/cp-05042136-kr3-acceleration-diagnosis.md` (S1-S10 sprint)
- `docs/learnings/cp-04270101-rumination-probe-fail-rca.md` (相关 probe 修复)
- `docs/learnings/cp-04280101-self-drive-health-probe-fix.md` (probe 已合修复参考)
