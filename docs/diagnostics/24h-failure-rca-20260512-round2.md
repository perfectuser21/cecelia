# 24h 任务失败 92% 根因分析（Round 2）

**诊断时间**：2026-05-12（北京时间）
**分析窗口**：过去 24h（2026-05-11T00:00Z 之前 ~24h，即 2026-05-10T~00 → 2026-05-11T~10:39 UTC）
**触发原因**：Brain SelfDrive 派发 `[SelfDrive] 诊断：最近 24h 任务失败率 92% 根因分析`（PRD 数据：22 failed / 2 success）
**数据来源**：`GET http://38.23.47.81:5221/api/brain/tasks?status=failed|completed&limit=100`，按 updated_at ≤ 24h 过滤

> 本文是 [`24h-failure-rca-20260512.md`](./24h-failure-rca-20260512.md) 的 Round 2 增补。前一版聚焦 reaper/dispatcher/docker 三大基础设施洞，已落地 PR #2911/#2912/#2913。本轮窗口前推 12h，捕到一个**前一版没着重指出**的新失败聚类：**cortex Insight-to-Action 批次派发把 dispatcher 容量打爆**。

---

## 1. 数据总览

| 维度 | 数值 | 备注 |
|------|------|------|
| failed | **32** | API 实测；PRD 写 22，是派发时数据快照差异 |
| completed | **2** | 79c93cb8（self_drive 上一版 RCA 自身）+ 3405df27（task_id 入库修复）|
| 成功率 | 5.9%（2/34） | PRD 写 8%（2/24），数量级一致 |
| 真业务失败（evaluator FAIL） | 2 | W30/W31 happy 多用例 + W28 schema |
| watchdog_deadline | 1 | W30 harness_initiative |
| stale queued 清理 | 0（窗口内）| ops cleanup 已含在 reaper 模式 |
| 其余全是**基础设施失败** | 29/32（91%） | reaper 误杀 + dispatcher retry 空错 |

**关键时间标记（UTC）**：
- 最后一次失败：2026-05-11T10:39:45（W31 终验）
- 最早 P1 修复合入 main：2026-05-11T18:39:50（PR #2911 HOL skip）
- **=> 32 个失败 100% 发生在所有 P1 修复落地之前**。修复之后窗口内既无新失败，也无新成功 — 系统目前处于 idle。

---

## 2. 失败模式聚类

按 `error_message` + `trigger_source` 二维切：

| # | 模式 | 数量 | 占比 | trigger 主因 |
|---|------|------|------|--------------|
| A | `[reaper] zombie: in_progress idle >30min` | 9 | 28% | self_drive (5) + auto (2) + cortex (2) |
| B | `[ops zombie in_progress (updated_at frozen 6h+)]` 人工 reap | 8 | 25% | cortex Insight修复 batch |
| C | **空 error_message + retry_count=3** | 9 | 28% | **cortex Insight修复 batch 7 + self_drive 2** |
| D | `[reaper] zombie: in_progress idle >60min` | 2 | 6% | cortex（reaper 提阈后仍误杀）|
| E | `watchdog_deadline` | 1 | 3% | W30 harness_initiative |
| F | `final_e2e_verdict=FAIL`（真业务）| 2 | 6% | W28 / W31 |
| G | `{"verdict":"FAIL","summary":""} [ops cleanup stale queued >24h]` | 1 | 3% | arch_review brain_auto |

**Trigger source 分布（24h 内）**：
| trigger_source | failed | 占比 |
|----------------|--------|------|
| cortex | 18 | 56% |
| self_drive | 9 | 28% |
| auto (harness) | 4 | 13% |
| brain_auto | 1 | 3% |

**=> cortex Insight-to-Action 批次派发贡献了 56% 的失败，是本窗口失败的最大贡献者。**

---

## 3. 新增根因：Cortex Insight 批量派发把 dispatcher 容量打爆

### 现象

cortex 把 `relevance_score=9` 的 learning 转成 dev 任务行动化，本窗口共派发 18 个 `[Insight修复] ...` dev 任务，按 `queued_at` 分桶：

| queued_at (UTC) | 同分钟内任务数 |
|-----------------|---------------|
| 2026-05-10T16:10 | **5** |
| 2026-05-10T17:19 | **4** |
| 2026-05-10T18:39 | **4** |
| 2026-05-11T02:31 | 3 |
| 2026-05-11T06:16 | 2 |

5/4/4 是 cortex 一次决策派发的 batch size（每条 relevance≥9 learning → 1 dev task）。这种粒度的批次让 dispatcher 同分钟内涌入 4-5 个 dev 任务，超过 dispatcher slot 容量（B3 slot accounting 修复前实际可用 slot 经常虚低到 0-1）。

结果是 14 条（18 中 14 个）卡在 in_progress 6h+ → 被 ops 人工 reap（模式 B）或 retry=3 静默死掉（模式 C）。

### 根因双层

1. **派发层（cortex）**：没有 batch throttle，relevance≥9 的 learning 有多少就转多少 dev 任务，且**任务粒度极细**（每条 learning 一个 task，标题为 "Insight 修复 + learning summary"，DoD 经常缺失）。
2. **执行层（dispatcher）**：B3 slot accounting bug（已修，PR #2909）+ 任务真正派发后 graph 不回 callback_queue（已修，PR #2912）+ retry 失败不写 error_message（**未修，Gap G2 残留**）。

### 拆分粒度结论（回答 PRD 提问 2）

- **总量未超阈值**：24h 内 34 个任务，远低于 PRD 提到的 100/day 阈值
- **批次内粒度过细**：cortex 一条 learning 一个 dev task 的 1:1 拆分是反模式 — learning 之间高度相关（多条都在讲 "Insight-to-Action 物理强制"），应聚合成单个 task 而不是 18 个独立 task
- **派发不限速**：cortex 决策不带 batch_size 上限和派发间隔

---

## 4. 与 Round 1 RCA 的 Gap 对照

Round 1 已识别 3 个残留 Gap（G1/G2/G3），本窗口实测复发情况：

| Gap | 描述 | 本窗口是否复发 | 证据 |
|-----|------|----------------|------|
| G1 | dev 任务 >60min 被 reaper 误杀 | ✅ **复发 2 次** | 模式 D：2 条 cortex Insight 修复任务跑 >60min（生成 LLM agent 慢）仍被 reaper 杀 |
| G2 | dispatcher retry 不写 error_message | ✅ **复发 9 次** | 模式 C：9/9 空 error_message 全是 retry_count=3，事后无法 forensic |
| G3 | docker container 名冲突 | ❌ 未复发 | 本窗口无 exit=125 案例（不代表已修，只是没触发） |

**新增 Gap**：
- **G4**：cortex Insight-to-Action 派发**无 batch throttle、无任务聚合**，1:1 把 learning 转 task → 短时间内 18 个 dev 任务涌入 dispatcher

---

## 5. 改进方案（按 ROI 排序）

### Fix-4（G4，新增，高 ROI）：cortex Insight 派发增加 batch size 上限 + 聚合策略

**位置**：cortex 派发 `Insight修复` dev 任务的代码路径（`packages/brain/src/cortex/*` 或 self_model/insight executor）

**改动**：
1. **批量上限**：单次决策派发 ≤ 3 个 dev 任务；超过的 learning 进 backlog 下一轮再派
2. **聚合**：相似 learning（按 cluster_id 或 cosine sim ≥0.7）合并为单个 dev task，title 用 cluster 摘要，description 列所有 learning_id
3. **派发节流**：相邻两批之间间隔 ≥10min，让 dispatcher 有消化时间

**预期收益**：消除 56% 的 batch-induced 失败。即使 dispatcher 不变更，单批 ≤3 也能塞进现有 slot。

### Fix-5（G1 升级，必做）：dev 任务也加进 reaper 豁免（短期 workaround）

**位置**：`packages/brain/src/reaper.js` 的 `ZOMBIE_REAPER_EXEMPT_TYPES` env

**改动**：把 `dev` 加进豁免列表。dev 跑 Claude Code agent 实测 >60min 是常态（特别是 cortex Insight 这种深度任务），reaper 不该是 dev 的首选防御。

**取舍**：会推迟真正僵死 dev 任务的回收。等 Fix-3（heartbeat）落地后撤销豁免。

### Fix-2（G2，前轮已提，再次强调）：dispatcher retry 路径必须写 error_message

本窗口 9 次复发（占失败 28%），所有 forensic 全靠人工 grep callback_queue 推断。前轮没做的原因不明，本轮要求优先级提到 P0。

### Fix-1（G3，前轮已提）：docker pre-clean

本窗口未触发，但 Fix-1 是幂等零成本的兜底，仍建议补上。

### Fix-3（G1 长期方案）：executor heartbeat 替代 idle reaper

前轮已提，方向不变。dev 任务跑 LLM agent 时由容器内 heartbeat 触发 tasks.updated_at，reaper 看 heartbeat 周期而非 idle 时长判 zombie。

---

## 6. 系统性 CI/代码质量问题排查（回答 PRD 提问 1）

**结论：无系统性 CI/代码质量问题。** 32 个失败：
- 29 是基础设施（reaper / dispatcher / batch overload）
- 2 是 evaluator FAIL（W28 schema、W31 happy 多用例）— 各是单点 harness 测试 spec 问题，不是 CI 系统问题
- 1 是 watchdog_deadline（W30）— 也是单点

CI 系统本身（brain-ci.yml / workspace-ci.yml / engine-ci.yml）24h 内无失败模式聚类。

---

## 7. Brain API / 存储层故障排查（回答 PRD 提问 3）

**Brain API**：本窗口实测 `http://38.23.47.81:5221/api/brain/tasks` 响应正常，无 5xx。

**存储层**：PR #2915（learning 入库强制 task_id）是直接证据 — Insight-to-Action 数据流之前断裂在 learning 表（task_id 字段不存）。已修复，本窗口未观测到该模式新失败。

**dispatcher 内部状态**：B3 slot accounting / HOL blocking 是真实 bug（已分别修于 PR #2909 / #2911），本窗口失败的 18 个 cortex 任务正是这两个 bug 叠加 batch overload 的产物。

---

## 8. 最常失败的任务类型（回答 PRD 提问 4）

| task_type | failed | 占比 | 主因 |
|-----------|--------|------|------|
| **dev** | 27 | 84% | cortex Insight 批次 18 + self_drive 诊断循环 9 |
| harness_initiative | 4 | 13% | W28/W30/W31 evaluator 或 watchdog |
| arch_review | 1 | 3% | brain_auto 定时巡检 stale queued |

**dev 任务是绝对主体**。其中：
- 18 条 cortex Insight 修复（67% of dev failures）
- 9 条 self_drive 自驱循环（多数自我诊断"诊断 24h 任务失败根因"递归排队，本轮 RCA 任务自身也是其中一条）

---

## 9. 行动项摘要

| ID | 行动 | 优先级 | 工作量 | 状态 |
|----|------|--------|--------|------|
| Fix-4 | cortex Insight 派发加 batch 上限 + 聚合 | **P0** | 2h | 待派发 |
| Fix-5 | dev 加进 reaper 豁免（短期 workaround） | P0 | 5min env 改 | 待派发 |
| Fix-2 | dispatcher retry 写 error_message | P0 | 1h | Round 1 已提，未做 |
| Fix-1 | docker-executor pre-clean | P1 | 0.5h | Round 1 已提，未做 |
| Fix-3 | heartbeat 替代 idle reaper | P2 | 3h | Round 1 已提，方向性 |
| Mon  | 24h 修复后回归监控（成功率 ≥70% 阈值）| P1 | 监控 24h | 排队等 Fix-4 落地 |

---

## 10. 附录：原始查询

```bash
curl -sS "http://38.23.47.81:5221/api/brain/tasks?status=failed&limit=100" \
  | python3 -c "import json,sys; from datetime import *; \
    data=json.load(sys.stdin); \
    cutoff=datetime(2026,5,12,tzinfo=timezone.utc)-timedelta(hours=24); \
    print(len([t for t in data if datetime.fromisoformat(t['updated_at'].replace('Z','+00:00'))>=cutoff]))"
```

聚类与桶分见本 commit history。
