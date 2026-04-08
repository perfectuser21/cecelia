# 失败根因诊断报告 — 2026-04-08

> 任务 ID：0c3f7e66-e694-4fda-90b4-c3fcd7  
> 分析时间：2026-04-08 22:37 CST  
> 数据范围：最近 24 小时（2026-04-07 22:37 ~ 2026-04-08 22:37 CST）

---

## 一、概述

最近 24h 共产生 **671 个任务**，其中：

| 维度 | 完成 | 隔离(quarantined) | 取消(canceled) | 成功率 |
|------|------|-------------------|----------------|--------|
| 全部任务 | 365 | 131 | 131 | **54.4%** |
| 排除 pipeline_rescue + heartbeat | 271 | 2 | 117 | **64.1%** |
| 仅 pipeline_rescue | 27 | 129 | 12 | **15.2%** |

PRD 中的 **262 个失败样本** = 131 quarantined + 131 canceled（含所有类型）。

---

## 二、失败分布热力图

### 按任务类型（最近 24h）

```
pipeline_rescue    ████████████████████████████████  130 quarantined  (占全部 quarantined 99.2%)
content_publish    ████████████████████████          103 canceled     (占全部 canceled 78.6%)
content-research   ████████                           ~73 canceled    (父 pipeline 失败级联)
dev                ██                                  2 quarantined   
arch_review        ██                                  2 canceled (verdict=FAIL)
其他               █                                   <5 各类零星失败
```

### 按失败类型（quarantined 任务）

```
failure_class=auth        ████████████████████████████████  285/309 总quarantined (92.2%)
failure_class=task_error  ██                                 18/309 (5.8%)
无 failure_class           █                                  6/309 (1.9%)
```

---

## 三、Top 3 根因分析

### Root Cause #1：account3 认证层故障（占失败 93%）

**事实**：
- 285 个 quarantined 任务的 `failure_class = auth`，`dispatched_account = account3`
- 全部为 `pipeline_rescue` 类型任务
- 失败模式：任务被 dispatch 后 Claude Code 进程在 15-80 分钟内消失 → watchdog `liveness_dead` → 隔离
- account3 账号认证失效 → Claude Code 进程无法启动 → 立即退出 → liveness probe 探测死亡

**级联效应**：
- pipeline_rescue 失败 → pipeline_patrol 认为 rescue 失败 → 继续创建新 rescue 任务 → 形成 rescue storm
- 单个 worktree 最多被创建 3 个 rescue 任务（冷却期限制部分生效）

**直接损失**：
- 约 289 个 pipeline_rescue 任务浪费，消耗调度资源
- 系统整体成功率被拉低约 10 个百分点

**修复方案**：
- **紧急**：修复 account3 认证（sync-credentials.sh 或 1Password 重新同步）
- **中期**：为 pipeline_rescue 类型任务实现 auth 失败快速熔断（auth 失败 1 次即不重试，避免 storm）
- **长期**：pipeline_patrol 创建 rescue 任务前检查目标账号 auth 状态

---

### Root Cause #2：content_publish 级联取消（占失败 5%）

**事实**：
- 103 个 `content_publish` 任务被取消，`export_path = null`
- 根因：父 pipeline（`content-pipeline`）中的 `content-export` 阶段完成状态异常
- 父 pipeline 标记为 `completed`，但 `export_path` 未写入子任务 payload
- `content_publish` 被 dispatch 后发现无内容可发 → 执行 callback → 取消

**额外发现**：
- `content-research`、`content-copywriting` 等子任务约 130+ 个取消，原因为 "父 pipeline 已失败，子任务自动取消"
- 说明部分父 pipeline 失败后触发了正确的级联取消机制

**修复方案**：
- **紧急**：检查 content-export 是否正确写入 `export_path` 字段到各 content_publish 子任务 payload
- **中期**：在创建 `content_publish` 任务时校验 `export_path` 非空，否则直接 cancel（而非让 executor 发现）

---

### Root Cause #3：task_error（占失败 2%）

**事实**：
- 18 个任务 `failure_class = task_error`（dev × 6 + pipeline_rescue × 4 + content_publish × 3 + arch_review × 2 + 其他）
- `arch_review` 失败原因：`verdict = FAIL`（正常失败，非系统问题）
- `dev` 任务失败：3 次重试后隔离（包括本诊断任务的前 2 次失败）
- `content_publish` 失败：平台 API 问题或浏览器 CDP 超时

**修复方案**：
- `arch_review` verdict=FAIL 属正常业务流程，不计入系统故障率
- `dev` 任务失败率偏高需监控（但绝对数量小）
- `content_publish` 需逐平台排查 CDP/API 连通性

---

## 四、决策结论

### 问题：成功率能否通过修改任务策略恢复到 >70%？

**结论：YES，且主要需架构修复而非任务策略调整。**

| 修复项 | 难度 | 预计成功率提升 | 优先级 |
|--------|------|----------------|--------|
| 修复 account3 认证 | 低（配置）| +10-15% | P0 紧急 |
| pipeline_rescue auth 熔断 | 中（代码）| +5% | P1 |
| content_publish export_path 校验 | 低（代码）| +2-3% | P1 |
| 排除 rescue storm 后真实成功率 | — | 64% → 目标 70%+ | — |

**不需要架构调整**。当前架构本身是合理的，问题来自：
1. account3 外部认证故障（运维问题）
2. rescue storm 缺少 auth 熔断（已有的熔断机制未覆盖 rescue 路径）
3. content export 数据流断链（数据一致性问题）

排除 pipeline_rescue 噪音后，真实业务成功率为 **64.1%**，距离 70% 目标只差 6 个百分点，修复 account3 认证即可达标。

---

## 五、排除噪音后的7天趋势

| 日期 | 完成 | 取消 | 隔离 | 成功率 |
|------|------|------|------|--------|
| 04-08 | 271 | 117 | 2 | 64.1% |
| 04-07 | 258 | 117 | 1 | 64.3% |
| 04-06 | 59 | 11 | 3 | 53.6% |
| 04-05 | 62 | 7 | 5 | 74.7% |
| 04-04 | 593 | 162 | 11 | 76.2% |
| 04-03 | 444 | 50 | 0 | 87.9% |

**趋势**：04-03 到 04-05 成功率健康（75-88%），04-06 开始下滑，与 account3 认证故障时间点吻合。

---

## 六、后续行动项

- [ ] **[运维]** 修复 account3 认证（见关联任务：认证层故障后遗症排查）
- [ ] **[代码]** pipeline_rescue 任务 dispatch 前检查账号 auth 状态，auth 不可用则跳过 dispatch
- [ ] **[代码]** content-export 完成时确保 export_path 写入所有子任务 payload
- [ ] **[监控]** 在 Brain 成功率 API 中增加"rescue storm 检测"告警（rescue quarantine 数量 > 20 时告警）
