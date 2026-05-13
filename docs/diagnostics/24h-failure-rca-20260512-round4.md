## 24h 任务失败根因（Round 4）— 反馈循环第 7 次

**诊断时间**：2026-05-12T02:05Z
**分析窗口**：2026-05-11T02:05Z → 2026-05-12T02:05Z（滚动 24h）
**触发任务**：`69f62455`（[SelfDrive] P0诊断：分析过去24h任务失败根因）
**前序**：Round 1 / Round 2 / Round 3（同目录）

> Round 3 §5 已点名 self_drive 在 24h 内 6 次重派同一诊断 intent。本任务即第 7 次。Round 4 不重写根因谱（沿用 Round 1-3），只汇报"自 Round 3 写出（5/12T00:19Z）后 ~1.8h 内系统侧的实测变化"，并把"应该停手了"四个字写在最显眼的位置。

---

### 1. 实测数据（API @ 5/12T02:05Z）

| 维度 | Round 3（5/12T00:19Z）| Round 4（5/12T02:05Z）| Δ |
|------|----------------------|----------------------|----|
| 24h failed | 24 | **16** | -8（窗口前推 1.8h，cortex 早期批次掉出）|
| 24h completed | 2 | **3** | +1（Round 3 RCA 任务 8cdccdac 自身完成）|
| 成功率 | 7.7% | **15.8%（3/19）** | +8.1pp（**完全是窗口效应**，分子未真增）|
| in_progress | 2（卡 13h）| **2（仍卡 13h）** | 任务 id 已换，模式不变 |
| queued | 0 | **0** | 持平 |

---

### 2. 自 Round 3 后系统侧的 3 个新事实

**① Round 3 时卡住的 2 条任务被 reaper 处理掉了，但 finished_at 仍为 null**

| Round 3 时 in_progress 的 id | 当前 status | finished_at | 解读 |
|---|---|---|---|
| `8cdccdac`（Round 3 RCA 任务）| `completed` | **null** | reaper / dispatcher 至少能改 status，但 callback 回写 finished_at 仍坏 |
| `48675f4d`（W32 harness）| `failed` | **null** | 同上 |

**含义**：PR #2913（reaper 阈值 + 豁免）**部分生效**——它能把 zombie 推向终态，但 PR #2912（dev-task graph 回写 callback_queue）**未生效**：finished_at/error_message 仍未回写。Gap G2 在两条样本上同时复现。

**② 派发流停摆从 5.7h 延长到 13h**

最近一次任务派发时间 = `2026-05-11T13:02:59Z`（即当前 in_progress 的 `69f62455`）。距今 **13h，0 新派发，0 新 queued**。

cortex / self_drive 决策回路按 tick loop 5-30min 应有数十次决策机会。证据上，Round 3 §4 的 Gap G5（派发流停摆）从 5.7h → 13h 持续恶化，**P1 修复合入 main 后已经过去 ~17.5h，post-merge 仍 0 任务进入系统**。

**③ self_drive 反馈循环第 7 次**

24h 内 self_drive failed = 5 条 + completed = 1 条 + in_progress = 1 条（本任务），**全部 7 条标题都是"诊断 24h 失败"或"冲刺 KR"**：

```
6/7 条诊断主题：
  [SelfDrive] 诊断任务成功率 0% 的根本原因                       (failed)
  [SelfDrive] 诊断最近 24h 任务失败根因                            (failed)
  [SelfDrive] [P1] 诊断 24h 任务失败根因：成功率 0% 系统性故障    (failed)
  [SelfDrive] [P1 紧急诊断] 24h 任务成功率 0% + 21 次业务失败...  (completed = Round 1)
  [SelfDrive] 诊断：最近 24h 任务失败率 92% 根因分析              (completed = Round 3)
  [SelfDrive] P0诊断：分析过去24h任务失败根因                      (in_progress = Round 4 自己)
1/7 条 KR 冲刺：
  [SelfDrive] 冲刺 KR3 / 冲刺 KR4                                 (failed)
```

**Round 1/3 都已 completed 并写出文档，self_drive 仍持续派第 7 条同 intent 任务**——证明 self_drive 决策器既未读 dev-records 也未做 title/intent 去重。

---

### 3. Top3 失败原因（24h 内 16 条 failed 的频率分布）

| # | 模式 | 数量 | 占比 | 根因层 |
|---|------|------|------|--------|
| 1 | `[reaper] zombie idle >30min` 或 `>60min` | **11** | 69% | 基础设施（dispatcher 不写 error_message + callback 回写漏）|
| 2 | harness `final_e2e_verdict=FAIL`（W28/W30/W31/W33）| **4** | 25% | walking-skeleton P1 spec 自身缺陷 |
| 3 | `watchdog_deadline`（W30）| 1 | 6% | harness 长时间任务超时 |

**未出现"代码质量"类失败**——CI/lint/test 类 0 条。

按 trigger：cortex 5 / self_drive 5 / auto 6（6 条 auto 全部是 W28-W33 harness 验证）。
按 task_type：dev 10 / harness_initiative 6。

---

### 4. 修复方向（Round 3 行动项 + Round 4 增量）

#### 沿用 Round 3（**全部未启动**）

| ID | 行动 | 优先级 | Round 4 备注 |
|----|------|--------|--------------|
| Act-A | 排查 Brain reaper / dispatcher 当前状态 | P0 | **部分自验**：reaper 能把 zombie 推向终态，但 callback 回写漏（Gap G2）仍存 |
| Act-B | 排查派发流停摆根因（cortex/self_drive 0 新派）| P0 | **持续恶化**：5.7h → 13h |
| Fix-2 | dispatcher retry 写 error_message | P0 | 本任务 retry=0 / err=null 又是活样本 |
| Fix-4 | cortex Insight 派发去重 + 节流 | P0 | 沿用 |
| Fix-5 | dev 加进 reaper 豁免（短期）| P0 | reaper 已可推 dev → terminal，**本项可降级** |
| Mon | 修复后回归监控（成功率 ≥70%）| P1 | 仍**无法启动**，依赖 Act-B |

#### Round 4 增量

| ID | 行动 | 优先级 | 工作量 |
|----|------|--------|--------|
| **Fix-6** | self_drive 决策器：派发前查近 24h 同 intent（按 title 关键词 cluster 或 task hash）已存在则跳过 | **P0** | 1h |
| Fix-7 | callback_queue 写入路径补 finished_at + 真正 error_message（与 Fix-2 同源 PR）| P0 | 1h |
| **Stop-Diag** | **暂停 self_drive 诊断主题派发**（人工 disable 该 intent 24h，等 Act-B 落地）| **P0 立即** | 5min |

---

### 5. 给主理人的一句话

**第 7 次写"24h 失败诊断"了。Round 1/3 文档都在仓库里，第 4-7 次失败都是因为 dispatcher / reaper 没修，不是因为没诊断。** 现在该做的不是再开 Round 5，而是：

1. 立即关掉 self_drive 的"诊断 24h 失败"派发开关（Stop-Diag）；
2. ops 上 Brain 拉一次进程级排查（Act-A/B），把"为什么 13h 0 派发"先答完；
3. 然后再决定是否需要 Round 5——如果 Act-B 答完后派发流恢复且 Mon 能启动，**Round 5 不需要存在**。

---

### 6. 数据查询

```bash
# Round 4 用到的 3 个查询（窗口起 = 5/11T02:00Z）
curl -sS "http://38.23.47.81:5221/api/brain/tasks?status=failed&limit=100" \
  | jq '[.[] | select(.updated_at >= "2026-05-11T02:00Z")] | length'

curl -sS "http://38.23.47.81:5221/api/brain/tasks?status=in_progress&limit=50" \
  | jq '.[] | {id, started_at, updated_at, retry_count, error_message}'

curl -sS "http://38.23.47.81:5221/api/brain/tasks/8cdccdac-9d32-422b-a83c-086404511b5f" \
  | jq '{status, finished_at, error_message}'  # 验证 Round 3 任务终态 + Gap G2 复现
```
