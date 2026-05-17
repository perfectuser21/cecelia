# 任务失败率骤降诊断报告

**诊断时间**: 2026-04-08（上海时间）  
**分析窗口**: 过去24h vs 历史7天基线（前6天）  
**触发原因**: Brain 自驱动预警 — 任务成功率异常下降

---

## 1. 数据总览

| 维度 | 24h（异常期） | 前6天（基线） |
|------|-------------|-------------|
| 完成任务 | 125 | ~375 |
| 隔离任务（quarantined） | 263 | 74 |
| **成功率** | **32%** | **84%** |
| 任务总量 | 388 | ~449 |

> 注：PRD 中"17%成功率"为分析触发时的快照值，当前已回升至 32%（因 dedup fix 已部署）。

**成功率骤降 52 个百分点**（84% → 32%）。

---

## 2. 失败分布特征（失败任务 Top 5）

### #1: pipeline_rescue 任务风暴（88%，231/263）

**性质**: 非真实业务失败，是监控系统自产生的噪音任务  

**现象**:
- 23 个死亡/孤立 worktree 分支，每个被重复创建 10-26 次 rescue 任务
- 所有 rescue 任务均以 `liveness_dead` 失败（watchdog 超时杀死）
- 典型分支：`cp-04050148`（26次）、`cp-04071725`（22次）、`cp-04060439`（20次）

**根因**: `pipeline-patrol.js` 的 dedup 检查漏洞 —
```sql
-- 旧逻辑：只排除 completed/cancelled/failed，遗漏了 quarantined
status NOT IN ('completed', 'cancelled', 'canceled', 'failed', 'quarantined')
```
当 rescue 任务本身被隔离（quarantined）后，不在 dedup 检查范围内，下次 tick 依然重建，形成**无上限重建循环**。

**修复状态**: ✅ **已修复**  
PR #2004 于 2026-04-08 12:48（上海时间）合并，quarantined rescue 任务纳入 72h 冷却期。  
**验证**: 部署后 >11 分钟内，0 条新 rescue 任务创建。

---

### #2: SelfDrive dev 任务 liveness_dead（8%，22/263）

**性质**: 正反馈噪音循环  

**现象**:
- Brain SelfDrive 感知到成功率下降，不断创建「诊断失败根因」任务
- 这些诊断任务本身也以 `liveness_dead` 失败（无空闲 agent 执行）
- 任务标题雷同：
  - "任务失败根因分析 — 262失败样本诊断"
  - "诊断：任务成功率下降至48%的根本原因分析"  
  - "任务质量诊断 — 分析48%成功率的根本原因"
  - ...共 10+ 个同类型任务

**根因**: SelfDrive 的自驱策略在感知到异常时触发任务创建，但缺乏对「同类诊断任务已存在」的去重保护，导致重复派发。

**修复状态**: ⚠️ **待修复**（见应急方案 §4.2）

---

### #3: Harness 组件失败（4%，7/263）

| 类型 | 24h 数量 | 状态 |
|------|----------|------|
| sprint_contract_propose | 4 | PR #2003 已修复 |
| sprint_planner | 2 | PR #2000 已修复 |
| sprint_generate | 1 | PR #2000 已修复 |

**已由近期 PR 修复，非持续问题。**

---

### #4: arch_review 失败（1%，2/263）

`arch_review` 类型任务隔离，数量少，属于 Harness v4.0 迁移过程中的边缘情况。

---

### #5: content-pipeline 失败（<1%，1/263）

孤立的 content-pipeline 任务，单次失败，不成趋势。

---

## 3. 与历史基线对比

| 类型 | 前6天（日均）| 24h | 倍数 |
|------|------------|-----|------|
| pipeline_rescue quarantined | ~10/天 | 231 | **23x** |
| dev quarantined | <1/天 | 22 | **22x** |
| 总 quarantined | ~12/天 | 263 | **22x** |

结论：**这是一次局部量级爆炸，而非全面崩溃。** 正常业务任务（content_publish、sprint_evaluate、content-copywriting 等）的成功率未受影响。

---

## 4. 与最近系统变更的关联性

### 相关变更时间线

| 时间（上海） | 事件 | 关联性 |
|------------|------|------|
| 04-07 10:30 | PR #2000: Harness v4.0 合并 | sprint_planner/sprint_generate 修复 |
| 04-07 23:53 | PR #1997: harness verdict 修复 | 低关联 |
| 04-08 01:00 | PR #1998: GET /tasks sprint_dir 过滤 | 低关联 |
| 04-08 10:30 | PR #2000 实际部署 | — |
| 04-08 12:32 | PR #2003: harness_* task types 修复 | Harness 组件失败修复 |
| **04-08 12:48** | **PR #2004: pipeline-patrol dedup 修复** | **✅ 核心修复** |

**pipeline_rescue 风暴与系统代码变更无直接关联**。风暴是由历史积累的孤立 worktrees（最老的来自 04-04）和 dedup 漏洞共同造成的，随着 worktree 数量超过临界值后爆发。

---

## 5. 应急改进方案

### 5.1 已完成（PR #2004）
- [x] quarantined rescue 任务纳入 72h 冷却期 dedup 检查
- [x] 验证：部署后 11 分钟内无新 rescue 任务

### 5.2 建议跟进（P1）
**SelfDrive 诊断任务去重**：在 SelfDrive 创建任务前，检查是否已有相同 title 前缀的 `in_progress` 或 `queued` 任务，避免重复创建同类诊断任务。

```javascript
// 建议在 self-drive.js 的任务创建前增加：
// SELECT COUNT(*) FROM tasks WHERE title LIKE '%诊断%成功率%' 
//   AND status IN ('queued', 'in_progress') 
//   AND created_at > NOW() - INTERVAL '24 hours'
```

### 5.3 建议跟进（P2）
**孤立 Worktree 清理机制**：定期清理（日频）超过 7 天的孤立 worktrees，减少 pipeline-patrol 的扫描负担。

---

## 6. 当前状态

**成功率已开始恢复**（截止报告生成时）：
- dedup fix 生效后 11 分钟内：0 条新 rescue 任务
- 预计 1 小时内成功率回升至 >80%
- 存量的 263 条 quarantined rescue 任务将维持隔离状态（72h 后解除），不会重建
