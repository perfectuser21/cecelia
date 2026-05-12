# 24h 任务失败率 92% 根因分析（Round 3）

**诊断时间**：2026-05-12 00:19 UTC
**分析窗口**：2026-05-11T00:18Z → 2026-05-12T00:19Z（滚动 24h）
**触发原因**：Brain SelfDrive 派发 `[SelfDrive] 诊断：最近 24h 任务失败率 92% 根因分析`（task id `8cdccdac`，PRD 快照：22 failed / 2 success）
**数据来源**：`GET http://38.23.47.81:5221/api/brain/tasks?status=failed|completed|in_progress|queued&limit=100`

> 本文是 Round 1（`24h-failure-rca-20260512.md`）和 Round 2（`24h-failure-rca-20260512-round2.md`）的窗口前推增补。Round 1/2 已完整覆盖 reaper / dispatcher / docker / cortex 批次四类根因（Gap G1-G4 + Fix-1~5）。**本轮不复述前两轮已定位的成因**，只补 24h 滚动窗口前推 ~14h 之后的三条新证据。

---

## 1. 数据总览（API 实测，截至 2026-05-12T00:19Z）

| 维度 | 数值 | 备注 |
|------|------|------|
| failed（窗口内） | **24** | PRD 快照 22，派发后又新增 2 条（W30/W31）|
| completed（窗口内） | **2** | 5/11T08:48 cortex Insight 修复 + 5/11T08:51 Round 1 RCA 自身 |
| 成功率 | **7.7%（2/26）** | PRD 写 8%，一致 |
| in_progress（当前） | **2** | 见 §3，updated_at 卡 13h |
| queued（当前） | **0** | dispatcher 队列空 |

**滚动窗口拓宽对照**：

| 窗口 | failed | completed | 成功率 |
|------|--------|-----------|--------|
| 24h | 24 | 2 | 7.7% |
| 48h | 47 | 3 | 6.0% |
| 72h | 52 | 12 | 18.8% |

72h 看回去成功率回升到 18.8%，说明本次故障窗集中在 24-48h 区段，与 Round 1/2 数据吻合（cortex 批次 + zombie reap 集中在 5/10~5/11）。

---

## 2. 失败模式分布（与 Round 2 完全一致，不重复根因）

| # | 模式 | 数量 | trigger 主因 |
|---|------|------|--------------|
| A | `[reaper] zombie idle >30min` | 9 | self_drive 5 + cortex 2 + auto 2 |
| B | 空 error_message + retry=3 | 9 | cortex Insight 批次 7 + self_drive 2 |
| C | `[reaper] zombie idle >60min` | 2 | cortex（reaper 提阈后仍误杀）|
| D | evaluator `final_e2e_verdict=FAIL` | 2 | W28（schema 完整性）+ W31（happy 多用例）|
| E | `watchdog_deadline` | 1 | W30 harness_initiative |
| F | ops cleanup stale queued >24h | 1 | arch_review brain_auto |

**task_type**：dev 19（79%）/ harness_initiative 4（17%）/ arch_review 1（4%）
**trigger_source**：cortex 10（42%）/ self_drive 9（38%）/ auto 4（17%）/ brain_auto 1（4%）

→ 与 Round 2 的 32 起失败相比，本窗口少 8 起，差异是窗口前推 ~14h 后掉出去的 cortex 早期批次。**模式分布、根因聚类完全一致**，无新增失败模式。

---

## 3. 新证据 ①：当前 in_progress 卡死 13h，Gap G2 在线复现

API 实测当前 `in_progress` 仅 2 条，且都在 P1 修复合入 main（5/11T18:39 PR #2911）**之前** dispatch 出去：

| id | task_type | trigger | queued_at | started_at | updated_at | retry_count | error_message |
|----|-----------|---------|-----------|------------|------------|-------------|---------------|
| `8cdccdac` | **dev** | self_drive | 11:02:19 | 11:17:06 | 11:02:19 | **1** | **null** |
| `48675f4d` | harness_initiative | auto | 11:00:10 | 11:02:01 | 11:00:10 | 0 | null |

**关键观察**：
1. `updated_at < started_at` —— graph 启动后从未回写 `tasks.updated_at`。这正是 Round 1 Fix #2912 想修的 callback_queue 回写 hole；W32（harness_initiative）跑在 P1 修复**之前**派发，不能证伪修复有效，但**当前任务 `8cdccdac` 自身**（即本份 RCA 任务）就是 retry=1 + error_message 空白的活样本——**Gap G2（retry 路径不写 error_message）原样复发**。
2. dev 任务 `8cdccdac` updated_at 距今 13h，远超 reaper 60min 阈值，但**未被 reaper 标 failed**。可能原因 3 选 1，需排查（Action 5）：
   - Brain 进程持有的 `ZOMBIE_REAPER_EXEMPT_TYPES` env 里临时加了 `dev`（与 Round 2 Fix-5 提议方向一致，可能 ops 手工先改了 env）；
   - Brain 进程在 5/11T11:02 之前启动且**之后未 restart**，仍跑旧代码（PR #2913 阈值 60min + 豁免列表已合入但未生效）；
   - reaper 5min 定时器因异常 throw 静默死掉。
3. **此现象意味着 PR #2912/#2913 是否真生效未被验证** —— 在 reaper 真正杀掉这 2 个卡 13h 的任务之前，所有"修复后 idle"的乐观判断都站不住。

---

## 4. 新证据 ②：P1 修复合入后 5.7h，派发流彻底停摆

P1 修复 PR 合入 main 时间线：

| PR | 合入时间（UTC）| 修复点 |
|----|---------------|--------|
| #2911 | 2026-05-11T18:39 | dispatcher HOL skip |
| #2912 | 2026-05-12T03:29* | dev-task graph 回写 callback_queue |
| #2913 | 2026-05-12T03:54* | reaper 阈值 30→60min + 豁免 harness_* |

（* PR #2912/#2913 commit 时间在 UTC 凌晨，按 `git log` 时间，本写作时间已晚于其 commit。）

**post-merge 窗口（5/11T18:39 ~ 现在 = 5.7h）**：

- failed = 0
- completed = 0
- 新派发任务 = 0
- queued = 0
- in_progress 仍是修复前那 2 条

Round 2 在 12h 前观察到"修复后无新失败也无新成功"，结论是系统 idle。**12h 之后仍然 idle**，且未来的 cortex/self_drive 决策回路理论上每 5-30min 跑一次（依 tick loop），24h 内**应当有数十次决策派发机会**——但实际 0 派发。

**这不是 idle，是派发流停摆**。可能原因（待排查）：

- cortex / self_drive decision 闭环依赖 `tasks.status` 变化触发，2 条 in_progress 卡死令决策器认为"任务在跑别派新的"（slot accounting 仍读 in_progress 计数虚高）；
- consciousness-loop guidance TTL（PR #7eb7a2fc5）落地后 stale guidance 失效，但新的 guidance 因为 reaper 没杀 in_progress 任务 → 决策器无法发现"failed 累积"信号 → 不触发新行动；
- dispatcher 在 HOL skip 落地后队列稳定为 0，但 cortex 派发器本身因 learning 入库强制 task_id（PR #2915）的副作用临时无法绑定 → 派不出新 dev task。

**结论**：Round 2 提议的"Mon — 24h 修复后回归监控 ≥70% 阈值"目前**无法启动**，因为没有任何 post-merge 任务进入系统。这是新发现的 Gap G5。

---

## 5. 新证据 ③：self_drive 自我递归循环

本窗口 9 条 self_drive 失败，标题去重：

```
[SelfDrive] [阻塞：等诊断] 修复自驱引擎 + 恢复queued任务调度
[SelfDrive] [P0] 诊断 & 加速 KR3 微信小程序上线
[SelfDrive] [SelfDrive] [P0] 紧急诊断：激活 queued 任务队列与自驱引擎恢复    ← 标题已嵌套
[SelfDrive] [P0] 诊断自动化基础故障：13个queued任务未执行根因 + 自驱health修复
[SelfDrive] 诊断任务成功率 0% 的根本原因
[SelfDrive] 诊断最近 24h 任务失败根因
[SelfDrive] 冲刺 KR4：/repo-audit 完成 90 分达标
[SelfDrive] 冲刺 KR3：管家闭环达成 100%
[SelfDrive] [P1] 诊断 24h 任务失败根因：成功率 0% 系统性故障
```

9 条里 **5 条是"诊断 24h 任务失败"或"激活 queued 队列"**——同一主题反复派发。本 RCA 任务（`8cdccdac`）本身是第 6 条，加上 Round 1 RCA（`79c93cb8`）+ Round 2 隐含的派发任务（已 completed 的不在此列），实质上 self_drive 在过去 24h **6 次重复派发同一诊断任务**，每次都因为 dispatcher/reaper 故障失败，下一轮 self_drive 又因为"看到失败"再次派发。**这是反馈循环失控，不是工作量大**。

Round 2 §3 提到"批次内粒度过细 + 1:1 拆分"是 cortex 反模式，**self_drive 的反模式是另一种：同一 intent 无去重持续重派**。归并入 Gap G4 的派发节流策略：派发前应做近 24h 相似任务去重（按 title cluster 或 intent 摘要）。

---

## 6. 回应 PRD 4 个检查项

1. **系统性 CI/代码质量问题**：**无**。CI 失败模式不构成系统性聚类，22/24 是基础设施而非代码质量。沿用 Round 2 §6 结论。
2. **任务拆分是否过度细化（>100/day 阈值）**：**总量未超**（24h 共 26 个任务），但 **cortex 1:1 + self_drive 重复派发**两个反模式在 24h 内合计制造 14 条 dev 任务，是事实上的过度细化。沿用 Round 2 §3 + 本轮 §5 结论。
3. **关键依赖（Brain API / 存储层）故障**：
   - Brain API 响应正常（实测 200，<2s）；
   - 存储层 learning task_id 绑定已修（PR #2915）；
   - **新发现**：reaper / 派发流可能停摆（§3 + §4），需排查 Brain 进程状态。
4. **最常失败的任务类型**：**dev**，占 79%（19/24）。其中 cortex Insight 修复 10 条 + self_drive 9 条。

---

## 7. 行动项（在 Round 2 基础上更新优先级）

| ID | 行动 | 优先级 | 工作量 | 状态 | 备注 |
|----|------|--------|--------|------|------|
| **Act-A** | **排查 Brain 进程当前 reaper / dispatcher 状态**：重启或观察 1 个 reaper 周期，期望 8cdccdac/48675f4d 被处理或解释为何不被处理 | **P0** | 30min | 待派发 | 验证 PR #2913 是否真生效，先决于其他动作 |
| **Act-B** | **排查派发流停摆根因**（cortex / self_drive 24h 0 新派发）| **P0** | 1h | 待派发 | Gap G5 新增，先于 Fix-4 落地 |
| Fix-4 | cortex Insight 派发加 batch 上限 ≤3 + 聚合 + 节流 ≥10min | P0 | 2h | 待派发 | Round 2 已提，本轮再强调；扩展去重逻辑覆盖 self_drive |
| Fix-5 | dev 加进 reaper 豁免（短期 workaround） | P0 | 5min env 改 | 待派发 | Round 2 已提；Act-A 排查后若确认 env 已临时改请把改动正式提到 PR |
| Fix-2 | dispatcher retry 写 error_message | P0 | 1h | 未做 | Round 1/2 都提过；本轮 §3 当前任务自身就是复发样本，证据已实锤 |
| Fix-1 | docker-executor pre-clean | P1 | 0.5h | 未做 | 本轮未触发，但建议补 |
| Fix-3 | heartbeat 替代 idle reaper | P2 | 3h | 未做 | 方向性 |
| Mon | 24h 修复后回归监控（成功率 ≥70%）| P1 | 监控 24h | **未启动** | 依赖 Act-A/B 解锁派发流 |

**优先序逻辑**：Act-A/B 先决于其他 Fix。Brain 不能派新任务，所有 Fix 落地都无法上线验证。

---

## 8. 给主理人的一句话总结

修复 PR 已合入 main 5.7h，但 reaper 没杀掉 2 条 13h zombie、24h 内 0 个新派发——**修复合入 ≠ 修复生效**。在重启 Brain 进程并观察 1 个 reaper 周期之前，所有"系统已恢复"的判断都不可信。

---

## 9. 附录：数据查询

```bash
# failed 24h
curl -sS "http://38.23.47.81:5221/api/brain/tasks?status=failed&limit=100" \
  | jq '[.[] | select(.updated_at >= "2026-05-11T00:18Z")] | length'

# 当前 in_progress + 字段
curl -sS "http://38.23.47.81:5221/api/brain/tasks?status=in_progress&limit=50" \
  | jq '.[] | {id, task_type, trigger_source, queued_at, started_at, updated_at, retry_count, error_message}'

# queued 数
curl -sS "http://38.23.47.81:5221/api/brain/tasks?status=queued&limit=50" | jq 'length'
```
