# 任务成功率下降诊断报告

**生成时间**: 2026-04-10 01:30 上海时间  
**诊断范围**: 2026-04-09T01:48 — 2026-04-10T01:48（24h窗口）  
**任务 ID**: 3d84b105-7499-4db2-a3d6-7a8e09c3d0c1

---

## 一、总体成功率

| 指标 | 数值 |
|------|------|
| 已完成任务 | 70 |
| 失败/取消/隔离任务 | 178 |
| 暂停任务 | 9 |
| 总任务 | 251（排除心跳/救援任务）|
| **实际成功率** | **27.9%** |

> 注：Brain 自驱任务创建时预估为 60%（135/225），差异原因在于诊断触发后新增了大量凭据告警类任务（+36），使分母扩大。

---

## 二、失败分类统计

| 编号 | 失败模式 | 数量 | 占比 | 严重等级 |
|------|----------|------|------|----------|
| F1 | Content Pipeline 静默取消（无 error_message）| 46 | 25.8% | P1 |
| F2 | Content Research 无错误取消 | 37 | 20.8% | P1 |
| F3 | 级联取消（父 pipeline 失败 → 子任务自动取消）| 39 | 21.9% | P1 |
| F4 | API Quota 耗尽（usage limit quarantined）| 36 | 20.2% | P1 |
| F5 | Research/Codex 网络连接失败（exit_code_1）| 41 | 23.0% | P2 |
| F6 | Pipeline 阶段明确失败 | 4 | 2.2% | P2 |
| F7 | Auth 认证失败（401）| 2 | 1.1% | P2 |
| F8 | Watchdog/Liveness 超时 | 1 | 0.6% | P2 |
| F9 | NotebookLM 返回空内容 | 1 | 0.6% | P3 |

> 注：部分任务跨多类（如 F2 部分属于 F3 的子任务），总数可能大于 178。

---

## 三、Top 5 失败模式详析

### 模式 1：Content Pipeline 批量静默失败（F1+F2，共 83 例）

**触发时间**: 集中在 2026-04-09 15:00–17:00（上海时间）  
**表现**: 46 个 `content-pipeline` 任务 + 37 个 `content-research` 任务被 cancelled，**全部无 error_message**  
**根因分析**:
- Pipeline Orchestrator 在某次执行中产生了未被捕获的异常
- 任务被取消时未写入 error_message，导致运维盲区
- 这 83 个任务均属于内容生产流水线（research → copywriting → review），属于系统最高频业务

**危险**: 静默失败意味着没有报警触发，Brain 无法识别并重试。

---

### 模式 2：级联取消放大效应（F3，39 例）

**触发条件**: 父 `content-pipeline` 任务失败 → `error_message = "父 pipeline 已失败，子任务自动取消"` → 所有子任务批量取消  
**放大系数**: 1 个父任务失败 → 平均 5–10 个子任务取消  
**根因分析**:
- 级联取消设计上是正确的（避免孤儿任务），但缺少"暂停 + 恢复"机制
- 父 pipeline 恢复后，子任务无法重新入队

---

### 模式 3：API Quota 耗尽自我强化（F4，36 例）

**触发链**:
1. 某时段 API quota 消耗速度过快
2. Brain 触发大量凭据告警任务（`credential-alert`，account1/2/3）
3. 这些告警任务本身也因 quota 耗尽被 quarantine
4. 形成正反馈循环：quota 不足 → 告警任务无法执行 → quota 继续耗尽

**受影响账号**: account1（17例）、account2（12例）、account3（7例）  
**当前状态**: 这 36 个任务仍在 quarantined 状态，未被处理

---

### 模式 4：Codex/Research 网络连接失败（F5，41 例）

**错误特征**: `exit_code_1 + chatgpt.com tunnel connection failed`  
**时间分布**: 全天分散，非批量  
**根因**: Codex CLI 连接 `chatgpt.com` 的 WebSocket/HTTP 隧道频繁超时断开  
**影响**: 所有 `research` 类型任务（依赖 Codex 执行）成功率仅 6.8%

---

### 模式 5：认证失败（F7，2 例）

**错误**: `401 Invalid authentication credentials`  
**影响**: 低（仅 2 例），但表明存在 token 过期 + 调度不感知的问题

---

## 四、Top 3 修复方案

### Fix-1（P1）：Content Pipeline 错误捕获 + 静默失败报警

**问题**: 83 个任务静默失败，Pipeline Orchestrator 异常未记录  
**方案**:
1. Pipeline Orchestrator 中所有 catch 块必须写入 `tasks.error_message`
2. Brain 增加检测器：连续 5 分钟内同类型任务取消率 > 80% → 触发 P1 告警 + 暂停该类型任务
3. 为 content-pipeline 添加幂等重试：取消前先尝试 1 次重试

**工作量**: 3–5 天（2 个文件：pipeline orchestrator + brain thalamus 检测规则）  
**预期收益**: 消除 25%+ 失败来源，同时使失败可观测

---

### Fix-2（P1）：API Quota 感知调度

**问题**: Quota 耗尽时仍在派发任务，凭据告警任务自身也死于 quota 耗尽  
**方案**:
1. Brain Tick 前检查各账号 quota 余量（通过 `/api/brain/quota-status` 或直接读 DB）
2. Quota < 10%：只派发 P0/P1 任务；Quota < 2%：暂停所有任务调度
3. 凭据告警/Quota 告警类任务使用专属轻量通道（不经 Claude API，直接写 DB + 发通知）
4. 将 36 个 quarantined 凭据告警任务标记为 cancelled，停止占用资源

**工作量**: 2–3 天（brain/tick.js + 新增 quota-guard.js）  
**预期收益**: 消除 quota 耗尽的正反馈循环，减少 20% 失败

---

### Fix-3（P1）：级联取消 → 级联暂停机制

**问题**: 父 pipeline 失败导致子任务不可恢复地取消  
**方案**:
1. 父 pipeline 失败时，子任务状态改为 `suspended`（不是 `cancelled`），并记录 `suspended_reason = parent_failed`
2. 父 pipeline 重新入队 / 恢复执行时，自动将 `suspended` 子任务重新激活
3. `suspended` 子任务保留 7 天，7 天后才真正 cancel

**工作量**: 2–3 天（brain/task-router.js + pipeline orchestrator）  
**预期收益**: 恢复 39 例级联取消中的大部分，减少 22% 失败

---

## 五、修复优先级 & 工作量

| 优先级 | Fix | 影响例数 | 工作量 | 负责方向 |
|--------|-----|----------|--------|----------|
| P1-即刻 | Fix-2（Quota感知调度）| 36 | 2–3天 | Brain tick + quota guard |
| P1-本周 | Fix-1（Pipeline静默失败）| 83 | 3–5天 | Pipeline orchestrator + 告警 |
| P1-本周 | Fix-3（级联暂停机制）| 39 | 2–3天 | Brain task-router |
| P2-下周 | Codex 网络重试（Fix-4）| 41 | 1–2天 | research dispatcher |
| P3 | NotebookLM 兜底 | 1 | 0.5天 | content pipeline stage |

---

## 六、后续行动

1. **立即**: 将 36 个 quota-quarantined 凭据告警任务批量标记 cancelled，清理队列
2. **本周**: 按 Fix-1/2/3 顺序创建 P1 修复任务并分配执行
3. **持续**: 建立任务成功率仪表盘（按 task_type 分类，24h 滚动窗口）
