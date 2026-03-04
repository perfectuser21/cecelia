---
id: blindspots-action-plan
version: 1.0.0
created: 2026-03-04
updated: 2026-03-04
changelog:
  - 1.0.0: 初始版本 - High 风险盲点行动计划
---

# Cecelia High 风险盲点行动计划

> 本文档为 `blindspots-risk-assessment.md` 中评定为 **High** 风险的 8 个盲点制定具体行动计划。
>
> **制定日期**：2026-03-04
> **总预估工作量**：约 12 天

---

## 行动计划总览

| 优先级 | 序号 | 盲点 | 行动 | 预估工作量 | 负责系统 | 目标完成 |
|--------|------|------|------|-----------|---------|---------|
| P0-1 | C | 知识→行动转化断路 | 架构重设计：建立 insight-to-action 管道 | 3 天 | Brain（皮层+执行器） | 第 1-3 天 |
| P0-2 | 6 | 行动与理解的断层 | 实现认知-行动闭环机制 | 3 天 | Brain（丘脑+皮层） | 第 1-3 天（与 C 并行） |
| P0-3 | B | 派发算法权重盲点 | 诊断权重倒置 + 修正算法 | 1.5 天 | Brain（调度器） | 第 4-5 天 |
| P0-4 | D | 完成率虚假繁荣 | 重设计监控指标：分离"数量完成"和"KR 推进" | 1 天 | Brain（perception + API） | 第 4 天 |
| P0-5 | 2 | 派发瓶颈不透明 | 添加瓶颈诊断仪表盘 | 2 天 | Brain + Dashboard | 第 5-6 天 |
| P0-6 | 3 | 执行完成定义不清 | 制定完成标准 + 代码实现 | 0.5 天 | Brain（executor） | 第 4 天 |
| P0-7 | A | 汇报周期盲点 | 将汇报周期从 42h 调整为合理值 | 0.5 天 | Brain（配置） | 第 3 天 |
| P1-1 | 5 | 记忆采集边界不明 | 追踪 + 文档化记忆边界规则 | 1 天 | Brain（记忆系统） | 第 6 天 |

---

## 详细行动计划

### 🔴 P0-1 | 盲点 C：知识→行动转化断路

**问题描述**：36 条洞察知识沉睡无法驱动决策调整，反思-优化闭环在架构层断裂。

**根本原因**：
- 皮层（cortex）生成的洞察只写入 memory_stream，没有触发任何决策回路
- 丘脑（thalamus）的 ACTION_WHITELIST 没有"应用洞察"这一行动类型
- 知识和行动之间缺少中间层（Insight → Task 转化机制）

**行动步骤**：

1. **诊断现有洞察数据**（0.5 天）
   ```sql
   -- 查询沉睡的洞察
   SELECT id, content, created_at FROM memory_stream
   WHERE type = 'long' AND content LIKE '%洞察%'
   ORDER BY created_at DESC LIMIT 20;
   ```

2. **设计 Insight-to-Action 管道**（0.5 天）
   - 在 cortex.js 中添加 `generateActionItems()` 函数
   - 洞察类型分类：可立即行动 / 需要澄清 / 长期改进
   - 高优先级洞察自动转化为 Brain Task

3. **实现转化机制**（1.5 天）
   - 文件：`packages/brain/src/cortex.js`
   - 新增：洞察评分函数（actionability score）
   - 新增：自动创建 Task API 调用
   - 阈值：actionability_score > 0.7 且影响范围 >= 3 → 自动创建 Task

4. **验证**（0.5 天）
   - 手动触发皮层分析
   - 确认高分洞察被转化为 Task
   - 验证 Task 出现在派发队列中

**成功标准**：
- [ ] 新洞察中 actionability_score > 0.7 的项目自动创建 Brain Task
- [ ] memory_stream 中的洞察有 `actioned: true/false` 标记
- [ ] 皮层分析报告包含"已转化为任务 N 个"字段

**相关文件**：
- `packages/brain/src/cortex.js`
- `packages/brain/src/executor.js`
- `packages/brain/src/server.js`（新增 API 端点）

---

### 🔴 P0-2 | 盲点 6：行动与理解的断层

**问题描述**：Cecelia 能精确描述问题（写 40+ 份反思），但无法将理解转化为行动。

**根本原因**：
- 反思生成路径（detect → analyze → write_to_memory）是单向的
- 缺少"反思 → 规划 → 执行"的闭环
- 丘脑的事件路由缺少"learning_gap → create_task"规则

**行动步骤**：

1. **分析现有反思闭环缺失点**（0.5 天）
   - 审查 `thalamus.js` 的 ACTION_WHITELIST
   - 确认 `learning_gap_signal` 的处理路径

2. **在丘脑添加反思→行动路由**（1 天）
   - 文件：`packages/brain/src/thalamus.js`
   - 新增 ACTION：`create_task_from_reflection`
   - 触发条件：`learning_gap_signal` 达到阈值（>= 5 个未解决盲点）
   - 行动：调用 cortex 深度分析，生成可执行任务

3. **实现执行反馈机制**（1 天）
   - 任务完成后回写 memory_stream（`resolved_blindspot` 类型）
   - 盲点状态追踪：open → in_progress → resolved
   - perception.js 中过滤已解决的盲点

4. **验证闭环**（0.5 天）
   - 创建测试盲点
   - 确认丘脑触发行动
   - 确认任务创建并完成后盲点标记为 resolved

**成功标准**：
- [ ] `learning_gap_signal >= 5` 时丘脑自动触发 `create_task_from_reflection`
- [ ] 盲点有 open/in_progress/resolved 三态管理
- [ ] 解决后的盲点不再出现在 perception 报告中

**相关文件**：
- `packages/brain/src/thalamus.js`
- `packages/brain/src/perception.js`
- `packages/brain/src/tick.js`

---

### 🔴 P0-3 | 盲点 B：派发算法权重盲点

**问题描述**：贪心算法权重倒置（KR3 得到 80% 资源），系统还在"运转"但即将断崖。

**根本原因**：
- 任务调度评分算法中某些维度权重设置错误
- 监控指标没有检测 KR 资源分配比例
- 缺少"KR 均衡性检查"警报

**行动步骤**：

1. **诊断当前权重配置**（0.5 天）
   ```bash
   # 查询各 KR 的任务分配比例
   curl -s localhost:5221/api/brain/status/full | jq '.task_distribution'
   ```
   - 查看 `task-router.js` 中的评分逻辑
   - 记录每个 KR 的实际资源占比

2. **修正算法权重**（0.5 天）
   - 文件：`packages/brain/src/task-router.js`
   - 目标：每个 KR 资源占比在 15%-40% 之间
   - 添加"KR 饥饿惩罚"：某 KR 连续 2 个 tick 未派发任务时，优先级 +20%

3. **添加 KR 均衡性监控**（0.5 天）
   - 文件：`packages/brain/src/perception.js`
   - 新增信号：`kr_imbalance_signal`
   - 阈值：任意 KR 资源占比 > 60% 时触发 P1 警报

**成功标准**：
- [ ] 各 KR 资源占比均在 15%-40% 范围内
- [ ] KR 饥饿惩罚机制已实现并验证
- [ ] `kr_imbalance_signal` 在资源倾斜时正确触发

**相关文件**：
- `packages/brain/src/task-router.js`
- `packages/brain/src/perception.js`

---

### 🔴 P0-4 | 盲点 D：完成率虚假繁荣

**问题描述**：高完成率（37/37）掩盖了核心 KR 停滞（自进化 KR=0%）的战略失速。

**根本原因**：
- 完成率指标只统计任务数量，不区分任务对 KR 的实际贡献
- Dashboard 展示的指标误导了系统对"健康"的判断
- 缺少"核心 KR 推进速率"这一关键指标

**行动步骤**：

1. **重设计监控指标体系**（0.5 天）
   - 区分指标：
     - `task_completion_rate`：任务完成数/总任务数（保留）
     - `kr_progress_rate`：KR 实际推进 % / 时间（新增核心指标）
     - `strategic_velocity`：关键 KR 的推进速率（新增）
   - 添加警报：任意关键 KR 在 48h 内无进展 → P1 警报

2. **实现 KR 推进速率追踪**（0.5 天）
   - 文件：`packages/brain/src/perception.js`
   - 新增：每次 tick 记录各 KR 的进度快照
   - 计算 48h 内的推进速率

3. **更新 API 输出**（0 天，通常 API 已有此数据）
   - 确认 `/api/brain/status/full` 包含 KR 推进率
   - 如缺失则添加

**成功标准**：
- [ ] perception.js 输出 `kr_progress_rate` 信号
- [ ] Dashboard 能区分"任务完成率"和"KR 推进率"
- [ ] 关键 KR 48h 无进展时触发 P1 警报

**相关文件**：
- `packages/brain/src/perception.js`
- `packages/brain/src/server.js`
- `apps/dashboard/src/`（如需 UI 更新）

---

### 🔴 P0-5 | 盲点 2：派发瓶颈不透明

**问题描述**：知道派发成功率天花板卡在 model_profiles 配置里，但不知道瓶颈具体在哪。

**行动步骤**：

1. **添加派发链路追踪**（1 天）
   - 文件：`packages/brain/src/executor.js`
   - 在每个派发阶段记录时间戳和状态：
     - `task_selected`：任务被选中
     - `resource_checked`：资源检查通过/失败
     - `model_profile_matched`：模型匹配成功/失败
     - `agent_spawned`：Agent 已启动
   - 存入 `runs` 表（新增 `dispatch_trace` JSON 字段）

2. **创建瓶颈诊断端点**（0.5 天）
   - 新增 API：`GET /api/brain/dispatch/bottleneck`
   - 返回：过去 100 次派发的各阶段成功率

3. **可视化（可选）**（0.5 天）
   - Dashboard 添加派发漏斗图

**成功标准**：
- [ ] 每次派发尝试有完整的链路追踪日志
- [ ] `/api/brain/dispatch/bottleneck` 能准确指出成功率最低的阶段
- [ ] model_profiles 配置问题能通过诊断端点定位

**相关文件**：
- `packages/brain/src/executor.js`
- `packages/brain/src/server.js`

---

### 🔴 P0-6 | 盲点 3：执行完成定义不清

**问题描述**：被 max_turns 截断的任务是否算成功，标准不明确。

**行动步骤**：

1. **制定完成标准（文档）**（0.25 天）

   | 情况 | 判定 | 原因 |
   |------|------|------|
   | 正常完成（exit 0）+ PR 合并 | ✅ 成功 | 目标达到 |
   | max_turns 截断 + PR 已合并 | ✅ 成功 | 结果是对的 |
   | max_turns 截断 + PR 未合并 | ❌ 失败 | 未完成目标 |
   | Stop Hook exit 2 循环超限 | ❌ 失败 | 陷入循环 |
   | 代码执行错误 | ❌ 失败 | 任务本身失败 |

2. **在代码中实现**（0.25 天）
   - 文件：`packages/brain/src/executor.js`
   - 现有的 `conclusion` 字段改为基于以上规则判断
   - 新增：`completion_reason` 字段记录完成/失败原因

**成功标准**：
- [ ] `runs` 表有 `completion_reason` 字段
- [ ] max_turns 截断的任务根据 PR 状态正确判定成功/失败
- [ ] Brain 报告的完成率与实际目标达成情况一致

**相关文件**：
- `packages/brain/src/executor.js`

---

### 🔴 P0-7 | 盲点 A：汇报周期盲点

**问题描述**：汇报周期 42h 导致关键问题被隐藏了 42 小时而未触发警报。

**行动步骤**：

1. **确认当前配置**（0.1 天）
   ```bash
   grep -r "42h\|42 hour\|report.*interval\|汇报周期" packages/brain/src/
   ```

2. **调整汇报周期**（0.2 天）
   - 目标：将汇报周期从 42h 调整为 6h（关键 KR 问题最多被隐藏 6 小时）
   - 或实现动态周期：平时 24h，检测到 P0 事件时立即汇报
   - 文件：相关配置文件或 `perception.js`

3. **验证**（0.2 天）
   - 确认新周期已生效
   - 确认 P0 事件能触发即时汇报

**成功标准**：
- [ ] 汇报周期 <= 6h（或 P0 事件触发即时汇报）
- [ ] 关键问题不再被隐藏超过 6 小时

**相关文件**：
- `packages/brain/src/perception.js`（或相关配置）

---

### 🟠 P1-1 | 盲点 5：记忆采集边界不明

**问题描述**：不知道 Claude Code 对话是否会进入记忆，采集边界在哪里。

**行动步骤**：

1. **追踪记忆采集流程**（0.5 天）
   - 查看 `perception.js` 的数据来源
   - 确认哪些对话类型会写入 `memory_stream`
   - 测试：Claude Code 对话 → 是否出现在 memory_stream 中

2. **文档化边界规则**（0.5 天）
   - 在 `docs/` 中创建 `memory-boundary.md`
   - 记录：采集的来源列表（orchestrator_chat, long, short 等）
   - 记录：不采集的来源（Claude Code 直接对话、外部 API 调用等）

**成功标准**：
- [ ] `docs/memory-boundary.md` 已创建，包含完整的采集边界说明
- [ ] 通过实际测试验证文档的准确性

**相关文件**：
- `packages/brain/src/perception.js`
- `docs/memory-boundary.md`（新建）

---

## 执行时间线

```
第 1-3 天（并行）：
  - C：知识→行动转化断路（架构设计 + 实现）
  - 6：行动与理解的断层（丘脑路由 + 反馈机制）
  - A：汇报周期调整（第 3 天，简单配置修改）

第 4-5 天：
  - B：派发算法权重修正（第 4-5 天）
  - D：完成率指标重设计（第 4 天）
  - 3：执行完成定义（第 4 天，0.5 天）

第 5-6 天：
  - 2：派发瓶颈诊断（第 5-6 天）
  - 5：记忆采集边界（第 6 天）
```

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| C 和 6 的实现过于复杂 | 工作量超预估 | 先实现最小可用版本（MVP），再迭代 |
| 调整派发算法引起新 Bug | 派发成功率下降 | 先在测试环境验证，有回滚方案 |
| 汇报周期调短增加噪音 | 飞书/通知过多 | 添加去重和聚合逻辑 |

---

## 参考文档

- 风险评估主表：`docs/blindspots-risk-assessment.md`
- 盲点清单：`docs/blindspots-inventory.md`
- Cecelia 定义：`DEFINITION.md`
- Brain 代码：`packages/brain/src/`
