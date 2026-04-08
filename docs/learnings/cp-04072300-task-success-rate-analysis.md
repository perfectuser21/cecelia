# 诊断报告：24h 任务成功率 39% 根因分析

**生成时间**：2026-04-08 14:10 CST  
**分析范围**：过去 24h（2026-04-07 14:00 — 2026-04-08 14:00 CST）  
**数据来源**：Brain DB（cecelia.tasks）  

---

## 1. 数据概览

| 状态 | 数量 | 占比 |
|------|------|------|
| quarantined | 214 | 43.4% |
| completed | 175 | 35.5% |
| queued | 47 | 9.5% |
| paused | 21 | 4.3% |
| cancelled/canceled | 27 | 5.5% |
| in_progress | 9 | 1.8% |

**表面成功率**：35.5%（completed / total）  
**对比参考**：2026-04-05 成功率 94.8%（系统正常基线）

---

## 2. 失败根因分类

### 根因 A：pipeline_rescue Storm（主要因素，占 quarantined 的 90.3%）

**数量**：289 / 321 quarantined 任务  
**类型**：`task_type = 'pipeline_rescue'`  
**失败模式**：`liveness_dead`（watchdog 双确认后 kill，retry_count = 0）  

**时间线**：

| 日期 | 创建数 | 成功 | quarantined | 成功率 |
|------|--------|------|-------------|--------|
| 2026-04-05 | 32 | 26 | 6 | 81.3% |
| 2026-04-06 | 211 | 3 | 196 | 1.4% |
| 2026-04-07 | 102 | 3 | 88 | 2.9% |

**根本原因**：pipeline-patrol dedup 漏洞（已有历史 PR #2004 修复）  
- quarantined 状态的 rescue 任务未纳入 72h 冷却期  
- 每次 tick 重新创建同目标的 rescue 任务  
- 导致同一个孤儿 pipeline 被反复 rescue，创建出数百个 rescue 任务  

**当前状态**：PR #2004 已合并（2026-04-08 早），最近 1h 仅 2 个新 rescue 任务，storm 已平息。

---

### 根因 B：account3 OAuth Token 过期（系统性 auth 故障）

**数量**：31 个任务  
**受影响 task_type**：
- `dev`: 23 个
- `sprint_contract_propose`: 5 个
- `sprint_planner`: 2 个
- `sprint_generate`: 1 个

**失败模式**：
```
"OAuth token has expired. Please obtain a new token or refresh your existing token."
API Error: 401 — authentication_error
```

**dispatch 路径**：所有失败任务均 `dispatched_account = account3`  
**结果**：任务被触发、worktree 创建成功，但 Claude Code 进程因 auth 失败立即退出，liveness probe 双确认后判定为 liveness_dead。

**次生问题**（account3 失败时的 worktree 残留）：
```
fatal: a branch named 'cp-XXXXX' already exists
```
- 任务重试时，branch 已存在导致 worktree 创建失败
- 但由于已被 quarantine 不再重试，影响有限

---

### 根因 C：SelfDrive 自诊断任务循环放大（元因素）

- Brain 检测到低成功率，自动派发 `[SelfDrive] 诊断任务失败根因` 系列任务
- 这些任务也被 dispatch 到 account3，全部失败
- 进一步压低成功率 → Brain 再派更多诊断任务 → 形成放大循环
- 共计 22 个 SelfDrive dev 任务被 quarantined

---

## 3. 去噪后的真实成功率

| 分类 | completed | quarantined | total | 成功率 |
|------|-----------|-------------|-------|--------|
| pipeline_rescue（噪音） | 6 | 194 | 223 | 2.7% |
| 业务任务 | 169 | 20 | 270 | 62.6% |

**去掉 pipeline_rescue 噪音后，业务任务真实成功率：62.6%**  
**如再去掉 account3 auth 失败（31个）：约 70.7%**

---

## 4. 7 天成功率趋势

| 日期 | completed | quarantined | 成功率 | 备注 |
|------|-----------|-------------|--------|------|
| 2026-04-02 | 27 | 0 | 46.6% | 初期低活跃 |
| 2026-04-03 | 515 | 0 | 55.3% | 正常 |
| 2026-04-04 | 697 | 11 | 76.0% | 正常 |
| 2026-04-05 | 506 | 11 | **94.8%** | 最高基线 |
| 2026-04-06 | 209 | 223 | 43.9% | ⚠️ Storm 开始 |
| 2026-04-07 | 128 | 92 | 43.0% | ⚠️ 持续 |

**结论**：这是短期波动，非长期恶化。由两个离散事件（pipeline-patrol dedup bug + account3 token 过期）叠加导致，与任务拆分粒度无关。

---

## 5. 修复建议

### P0 — 立即处理

**[已修复]** pipeline-patrol dedup 漏洞 → PR #2004 已合并

### P1 — 需处理

**account3 OAuth token 刷新**  
- 影响：所有 dispatch 到 account3 的任务（dev/sprint 类型）全部失败
- 操作：到 account3 的 Claude Code 设置中刷新 OAuth token
- 验证：`dispatched_account=account3` 的新任务成功执行

### P2 — 建议

**成功率计算排除 pipeline_rescue 噪音**  
- Brain 的成功率告警/指标计算中，应当将 `pipeline_rescue` 类型的任务单独统计，避免其 storm 掩盖业务任务的真实健康状态

**SelfDrive 自诊断触发阈值**  
- 当系统检测到低成功率时，应检查是否已有同类诊断任务在进行中，避免重复派发

---

## 6. 根本原因总结

```
24h 成功率 39% = 两个离散故障叠加

故障1：pipeline_rescue storm（PR #2004 修复，已平息）
  └── 根因：quarantined rescue 任务未纳入 72h 冷却期
  └── 影响：虚增 194 个 quarantined，压低整体成功率 ~20%

故障2：account3 OAuth token 过期（待修复）
  └── 根因：Claude Code account3 的认证令牌失效
  └── 影响：31 个 dev/sprint 任务全部失败
  └── 次生：SelfDrive 自诊断循环 × 22 个额外失败
```

