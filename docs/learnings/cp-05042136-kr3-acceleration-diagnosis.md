---
分支: cp-05042136-cortex-rca-cross-task-first
日期: 2026-05-05
任务: SelfDrive KR3 加速 25% → 50%
任务类型: dev (实为 analysis/planning)
---

# KR3 加速诊断 + 本周冲刺计划

## TL;DR

PRD 假设"阻块来自 RCA 发现的拆分问题"——**误读**。RCA（cp-05040101 / cp-05042136）已明确否定拆分粒度因素。真实阻块在三层：

| 层 | 阻块 | 影响 KR3 推进的方式 | 是否代码可解 |
|---|---|---|---|
| L1 调度底座 | tick-helpers.js:120 elapsed bug 未合 | 任何 dev 任务首次 60min 跑不完即死循环 → quarantine | 是（前置 RCA 给方案） |
| L2 范围蔓延 | 4 模块各 70-80%，无一上线 | 25% 进度计算无法跨过"可上线"门槛 | 否（产品决策） |
| L3 外部阻断 | 微信开发者工具人工操作 + WX Pay 商户号申请 | 代码完成 ≠ 进度推进，差最后一公里 | 否（人工/外部） |

**结论**：单纯派更多 dev 任务**毫无效果**——L1 不解，任务死在 quarantine；L2/L3 不动，再多代码也卡在 25%。

---

## 1. 阻块根因（按可解性排序）

### L1 — Brain 调度底座 P0 bug（最先解，最便宜）

引用 `cp-05042136-task-failure-rca-recurrence.md` §2.1-2.3：

- `tick-helpers.js:120`：`triggeredAt = task.payload?.run_triggered_at || task.started_at`，requeue 路径只清 `started_at`，`payload.run_triggered_at` 永不重置 → 第二次派发即超时 → 3 轮死循环 → quarantine
- v2 workflow runtime 加剧：`dispatcher._dispatchViaWorkflowRuntime` 完全不维护 `run_triggered_at`
- 前置 RCA cp-05040101 在 5/4 凌晨已写完精确修复方案，**至今未提交、未 PR、未合**（24h 26 commits 全在 stop-hook/engine 改造打转）

直接后果（用 5/4 21:36 数据）：14/40 任务成功（35%），其中 KR3 相关 dev 任务也在 quarantined 之列（"修复自身基础设施"任务无一幸免）。

**判断**：派给 KR3 的 dev 任务被同 bug 拖死，根本到不了"加速"的 starting line。

### L2 — KR3 v1 范围蔓延（产品决策）

引用 `cp-04082121-kr3-miniprogram-acceleration.md`：

- 原始 KR3 = "微信小程序基础功能可用"
- 实际扩为 4 模块：AI 聊天 + 会员付费 + 内容 CMS + Copywriter 创作流
- 每个 70-80% 完成，无一达"可上线"
- 进度计算用粗糙百分比，看起来 25%，本质是"4 个半成品"

**判断**：产品定义没收口，写多少代码都到不了 50%。

### L3 — 外部人工阻断（不可代码解）

引用 `cp-0414224938-kr3-status-update.md` + cp-04082121 §"根本原因"：

- 微信开发者工具：云函数部署、体验版提交、审核提交（必须人工）
- WX Pay 商户号申请（外部审批，已识别为外部阻断）
- 管理员 OpenID 已通过三层 fallback 解决（`o2lLz62X0iyQEYcpnS2ljUvXlHF0`）
- WX Pay 私钥 ✅ + setup 脚本 ✅，差外部申请

**判断**：Brain 把"外部阻断"误派为 dev 任务 → 重复调度浪费配额（前置 RCA 已识别此模式）。

---

## 2. 本周冲刺计划

### 优先级原则

> 先解锁底层 → 再缩范围 → 最后推外部链路。L1 不解 L2/L3 都白做。

### Sprint 列表（按依赖排序）

| # | 任务 | 类型 | 工时 | 依赖 | 责任侧 |
|---|---|---|---|---|---|
| S1 | tick-helpers.js:120 elapsed 修复（P0-A 选项 B：换优先级到 `started_at` 优先） | dev | 30min | — | Brain Codex |
| S2 | 三处 liveness 算法一致性同改（executor.js:3311 + 3347） | dev | 20min | S1 | Brain Codex |
| S3 | dispatcher._dispatchViaWorkflowRuntime 补写 `run_triggered_at`（P0-B） | dev | 20min | S1 | Brain Codex |
| S4 | deploy P0 + 人工 release 当前 quarantined 批次 | ops | 15min | S1-S3 | Alex |
| S5 | patrol_cleanup 自循环告警 trip-wire（30min ≥3 次同 task → 写 `cecelia_events.patrol_loop_suspect`） | dev | 1h | S4 | Brain Codex |
| S6 | KR3 v1 范围裁剪决策：4 模块收口为 "AI 聊天" 单模块（其余顺延 v2） | decision | 用户决策 | — | Alex |
| S7 | KR3 进度算法改 4 阶段（代码 25% / 云函数 60% / 提交审核 80% / 上线 100%） | dev | 1h | S6 | Brain Codex |
| S8 | KR 定义增"人工操作清单"字段（谁、何工具、何时） | spec | 30min | — | Alex |
| S9 | WX Pay 商户号申请进度 trip-wire（外部阻断不再误派 dev） | dev | 30min | — | Brain Codex |
| S10 | "AI 聊天"模块 v1 上线推进（云函数部署 + 体验版提交 + 审核） | manual | 半天 | S6 + S8 | Alex |

### 进度推算（保守）

| 节点 | 完成项 | KR3 进度算法（按 S7 4 阶段） | 备注 |
|---|---|---|---|
| 当下 | — | 25%（代码完成） | 实际 4 模块各 70-80%，但任一未上线 |
| 完成 S1-S5 | 调度底座解锁 | 25% | 解锁后续派发，不直接推进度 |
| 完成 S6 | 范围收口至"AI 聊天" | 25% | 决策不直接推进度，但让"50%" 可达 |
| 完成 S7 | 进度算法切换 | 25-40% | 仅"AI 聊天"模块按 4 阶段算，已完成代码部分 |
| 完成 S10 | 云函数部署 + 提交审核 | 60-80% | **真正抵达 50%+** |

S10 是关键里程碑——50% 不在写更多代码，**在完成一次 deploy + submit**。

---

## 3. 与 PRD 假设的对照

| PRD 假设 | 实情 | 修正 |
|---|---|---|
| "RCA 发现的拆分问题" | RCA 明确排除拆分因素 | 阻块在 elapsed bug + 范围蔓延 + 外部链路 |
| "调整资源配置" | 资源不是瓶颈，调度跑不动才是 | 先合 P0 修复，资源问题伪命题 |
| "制定本周冲刺计划" | ✓ 见 §2 Sprint 表 | 按依赖严格排序，S1→S10 |
| "依赖 RCA 任务完成后优化任务拆分" | RCA 已完成（双份），结论是不要改拆分 | 应改"依赖 P0 elapsed 修复合并" |

---

## 4. 立即可执行（今日内）

1. Alex 决策：S6 范围收口（保留"AI 聊天"，砍 3 模块）—— **没这个决策，所有 dev 任务都是低 ROI**
2. Brain Codex 派 S1+S2+S3 三个 dev 任务到同一 PR（合并为单 commit `fix(brain): elapsed algo + run_triggered_at v2 sync`）
3. Alex 待 PR merge 后执 S4 release 命令（命令在前置 RCA §P0-C）

---

## 5. 长期防护（不再发生）

1. KR 定义模板加 3 字段：MVP 范围边界 / 人工操作清单 / 外部阻断标识
2. SelfDrive 任务在派 dev 之前先查"外部阻断列表"，命中即跳过派发并通知 Alex
3. 任何"重置任务到 queued"路径必须走共享 helper `revertToQueued(task_id)`，统一清空时间锚字段（前置 RCA 已建议，仍未实施）
4. RCA 文档写完后必须 24h 内开 PR，否则触发 SLA 告警（本次教训：5/4 凌晨 RCA 写完，21:36 复发）

---

## 6. Follow-up

- [ ] S6 决策回写 `decisions` 表（Alex 决定后）
- [ ] S1-S3 PR merge 后回写本任务状态到 Brain（API 不可达时改用 stage-done.sh）
- [ ] 若 Brain `localhost:5221` 持续不可达，先查启动日志（PRD 闭环回写依赖此服务）

---

## 附 — 引用文档清单

- `docs/learnings/cp-05042136-task-failure-rca-recurrence.md` （L1 根因 + 复发证据）
- `docs/learnings/cp-05040101-task-failure-rca-24h.md` （L1 修复方案 P0-A/B/C）
- `docs/learnings/cp-04082121-kr3-miniprogram-acceleration.md` （L2 范围蔓延 + L3 外部阻断首诊）
- `docs/learnings/cp-0414224938-kr3-status-update.md` （L3 WX Pay 外部阻断细节）
- `docs/learnings/cp-04130945-kr3-status-post-pr2329.md` （历史进度参照）
