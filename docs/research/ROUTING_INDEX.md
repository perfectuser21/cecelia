# Cecelia Core 任务路由体系 - 研究文档索引

## 文档导航

### 1. 快速参考卡 (5 分钟快速入门)
**文件**: `/home/xx/perfect21/cecelia/core/ROUTING_QUICK_REFERENCE.txt`

最适合:
- 第一次接触本系统的人
- 需要快速查找信息的开发者
- 在命令行/编辑器中快速参考

内容:
- 5 个核心文件位置及功能
- 8 种任务类型速查表
- KR 评分公式 (一目了然)
- 常见修改位置速查
- 30+ Action 分类列表
- 9 种意图识别体系
- 调度流程图
- 资源管理阈值
- 3 大优化方向概览

### 2. 快速参考指南 (15 分钟了解全貌)
**文件**: `/home/xx/perfect21/cecelia/core/ROUTING_RESEARCH_SUMMARY.md`

最适合:
- 需要理解整个系统架构的人
- 计划做修改前的预备学习
- 团队知识共享

内容:
- 三层路由系统图
- 关键文件一览表
- 任务类型体系详解
- 调度评分公式说明
- 意图识别体系
- 丘脑 Action 白名单分类
- 三大优化方向深度分析
- 快速查询速查表
- 架构强项与改进机会

### 3. 详细研究报告 (30+ 分钟深入理解)
**文件**: `/home/xx/perfect21/cecelia/core/ROUTING_RESEARCH.md`

最适合:
- 需要深入理解系统设计原理的人
- 计划进行重大架构改进的团队
- 学术分析或系统设计参考

内容:
- **第 1 部分**: 任务路由机制
  - 路由入口文件详解 (task-router.js)
  - 核心函数说明
  - 路由规则流程图
  - Tick 循环中的任务路由
  - TASK_TYPE_AGENT_MAP 详解

- **第 2 部分**: 能力/技能定义系统
  - 丘脑 (Thalamus) 中的 Action 白名单
  - 30+ 个 Action 完整列表
  - 执行器中的 Actions
  - 系统任务定义

- **第 3 部分**: 任务匹配与调度流程
  - 规划器 (Planner) 的任务选择
  - 调度流程详细说明
  - KR 评分函数详解
  - PR Plan 调度机制
  - 执行器的任务派发
  - 资源管理详解

- **第 4 部分**: 意图识别系统
  - 意图类型定义 (9 种)
  - 意图到行为的映射

- **第 5 部分**: 优化点分析
  - 任务路由机制的优化潜力
  - 调度机制的优化潜力
  - 丘脑的优化潜力
  - 具体优化建议

---

## 快速导航

### 按场景查找

**场景 1: 我是新成员，想快速了解系统**
1. 先读: ROUTING_QUICK_REFERENCE.txt (5 分钟)
2. 再读: ROUTING_RESEARCH_SUMMARY.md (15 分钟)
3. 需要深入时再读: ROUTING_RESEARCH.md

**场景 2: 我要修改任务路由规则**
1. 查阅: ROUTING_QUICK_REFERENCE.txt 的 "常见修改" 章节
2. 参考: task-router.js (行 42-53 的 LOCATION_MAP)
3. 详细说明: ROUTING_RESEARCH.md 第 1.1 节

**场景 3: 我要添加新 task_type**
1. 查阅: ROUTING_QUICK_REFERENCE.txt "添加新 task_type" 部分
2. 需要改 3 处:
   - task-router.js: LOCATION_MAP
   - tick.js: TASK_TYPE_AGENT_MAP (行 42-48)
   - actions.js: isSystemTask() (如需要)
3. 详细流程: ROUTING_RESEARCH.md 第 1.2 节

**场景 4: 我要理解调度评分算法**
1. 查阅: ROUTING_QUICK_REFERENCE.txt 的 "KR 评分公式"
2. 代码实现: planner.js 第 45-78 行
3. 详细分析: ROUTING_RESEARCH.md 第 3.1 节的 scoreKRs() 函数

**场景 5: 我要了解丘脑的 Action 系统**
1. 查阅: ROUTING_QUICK_REFERENCE.txt 的 "丘脑 Action 白名单"
2. 代码位置: thalamus.js 行 142-187
3. 详细说明: ROUTING_RESEARCH.md 第 2.1 节

**场景 6: 我要优化系统的某个方面**
1. 快速概览: ROUTING_QUICK_REFERENCE.txt 最后的 "三大优化方向"
2. 详细分析: ROUTING_RESEARCH.md 第 5 部分

---

## 文档互引关系

```
ROUTING_INDEX.md (本文件)
├─ 推荐 → ROUTING_QUICK_REFERENCE.txt
│         ├─ 快速查找 → 各源代码文件
│         └─ 需要深入 → ROUTING_RESEARCH_SUMMARY.md
│
├─ 推荐 → ROUTING_RESEARCH_SUMMARY.md
│         ├─ 快速查找 → ROUTING_QUICK_REFERENCE.txt
│         └─ 需要深入 → ROUTING_RESEARCH.md
│
└─ 推荐 → ROUTING_RESEARCH.md
          └─ 快速查找 → ROUTING_QUICK_REFERENCE.txt
```

---

## 核心源代码位置

| 功能 | 文件 | 行数 | 关键要素 |
|------|------|------|----------|
| 任务路由 | task-router.js | 212 | LOCATION_MAP, identifyWorkType() |
| 调度规划 | planner.js | 545 | scoreKRs(), planNextTask() |
| 任务派发 | executor.js | 1661 | 资源管理、派发执行 |
| Agent 映射 | tick.js | 1613 | TASK_TYPE_AGENT_MAP, routeTask() |
| 决策验证 | thalamus.js | ~600+ | ACTION_WHITELIST, validateDecision() |
| 决策执行 | decision-executor.js | ~500+ | actionHandlers |
| 操作实现 | actions.js | 416 | createTask(), updateTask() 等 |
| 意图识别 | intent.js | ~700+ | INTENT_TYPES, INTENT_PHRASES |

---

## 核心概念速查

### 三层路由
- **L0 脑干 (代码)**: task-router.js → LOCATION_MAP / TASK_TYPE_AGENT_MAP
- **L1 丘脑 (Haiku)**: thalamus.js → 事件分类、快速判断
- **L2 皮层 (Sonnet)**: cortex.js → 深度分析、战略调整

### 8 种 task_type
`dev` | `review` | `qa` | `audit` | `exploratory` | `talk` | `research` | `data`

### 9 种意图
`CREATE_PROJECT` | `CREATE_FEATURE` | `CREATE_GOAL` | `CREATE_TASK` | `FIX_BUG` | `REFACTOR` | `EXPLORE` | `QUERY_STATUS` | `QUESTION`

### 30+ Actions
分为 8 类: 任务操作、OKR 操作、通知/日志、升级、分析、规划、学习、生命周期、系统

### KR 评分公式
`焦点(+100) + 优先级(+30/-20/-10) + 进度 + 截止日期 + 队列任务数`

---

## 常见问题

**Q: 我应该从哪个文档开始读？**
A: 如果你有 5 分钟，读 ROUTING_QUICK_REFERENCE.txt。如果有 20 分钟，再加上 ROUTING_RESEARCH_SUMMARY.md。如果有充足时间，读完整的 ROUTING_RESEARCH.md。

**Q: 我要修改什么，应该看哪个文件？**
A: 先看 ROUTING_QUICK_REFERENCE.txt 的 "常见修改" 章节，找到你要修改的地方的行号，然后去源代码文件修改。详细说明在 ROUTING_RESEARCH.md。

**Q: 文档中提到的源代码行号还准确吗？**
A: 本文档基于 2026-02-18 的代码库。源代码可能会更新，但总体结构应该不变。如果行号不准，用 Ctrl+F 搜索关键的变量/函数名。

**Q: 这三个文档有什么区别？**
A:
- ROUTING_QUICK_REFERENCE.txt: 单页纯文本参考卡，最快查找
- ROUTING_RESEARCH_SUMMARY.md: Markdown 文档，有结构有表格，适合学习
- ROUTING_RESEARCH.md: 详细研究报告，代码段 + 注释，适合深入理解

**Q: 我要提议优化系统，应该从哪里开始？**
A: 先读 ROUTING_QUICK_REFERENCE.txt 的最后 "三大优化方向" 部分，了解有什么改进空间。然后读 ROUTING_RESEARCH.md 第 5 部分，深入理解每个优化方向的细节。

---

## 文档元数据

| 属性 | 值 |
|------|-----|
| 研究日期 | 2026-02-18 |
| 研究范围 | /home/xx/perfect21/cecelia/core/brain/src |
| 核心文件数 | 8 个 |
| 总代码行数 | ~6500+ 行 |
| 文档总行数 | 1006 行 |
| 优化建议数 | 3 个 |
| 修改范例数 | 10+ 个 |

---

## 关于本研究

本研究纯粹是代码分析和架构理解，未对任何源文件进行修改。所有文件路径均为绝对路径，代码片段均包含准确的行号。

研究重点:
- 任务路由机制如何工作
- 能力/技能定义系统的设计
- 任务匹配与调度的算法
- 意图识别的实现
- 当前架构的优化机会

---

**最后更新**: 2026-02-18  
**下次更新建议**: 代码库重大更新后 (如添加新 region、新 task_type、修改评分算法等)
