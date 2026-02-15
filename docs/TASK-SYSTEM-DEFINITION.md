# Cecelia 任务系统定义

**版本**: 2.0.0
**创建时间**: 2026-02-04
**更新时间**: 2026-02-15
**状态**: 确认

---

## 1. 六层 OKR 架构

```
Global OKR (季度目标，3个月)
├── Area OKR (月度目标，1个月)
│   └── KR (Key Result，可量化指标)
│       └── Project (项目，1-2周)
│           └── Initiative (行动计划，1-2小时)
│               └── Task (最小执行单元，20分钟)
```

### 层级说明

| 层级 | 类型 | 时间维度 | 数据库 | 字段 |
|------|------|----------|--------|------|
| **Global OKR** | 季度总目标 | 3个月 | `goals` 表 | type='global_okr', parent_id=NULL |
| **Area OKR** | 领域月度目标 | 1个月 | `goals` 表 | type='area_okr', parent_id=Global OKR |
| **KR** | 可量化指标 | 月度 | `goals` 表 | type='kr', parent_id=Area OKR |
| **Project** | 代码项目 | 1-2周 | `projects` 表 | type='project' |
| **Initiative** | 行动计划 | 1-2小时 | `projects` 表 | type='initiative', parent_id=Project |
| **Task** | 最小执行单元 | 20分钟 | `tasks` 表 | project_id→Initiative, goal_id→KR |

---

## 2. OKR 嵌套示例

```
Q1 Global OKR: 构建自主运行的管家系统
├── Area OKR: Cecelia Core 稳定性
│   ├── KR1: 派发成功率 > 90%
│   │   └── Project: 保护系统增强
│   │       ├── Initiative: 实现熔断器恢复
│   │       └── Initiative: 优化看门狗阈值
│   └── KR2: 自动完成 > 5 个/天
│       └── Project: 调度优化
│           └── Initiative: KR 轮转评分
│
└── Area OKR: 自媒体运营
    ├── KR1: 日更 10 篇
    │   └── Project: 内容管理系统
    │       └── Initiative: 发布引擎
    └── KR2: 粉丝增长 1000
        └── Project: 涨粉计划
            └── Initiative: 互动策略
```

---

## 3. 对话层级

| 层级 | 聊什么 | 频率 |
|------|--------|------|
| **Global OKR** | 季度方向 | 季度 |
| **Area OKR** | 月度重点 | 月度 |
| **KR** | 指标进展 | 每周 |
| **Project** | 项目整体 | 每天 |
| **Initiative** | 具体行动 | **每天** |

**最小对话粒度是 Initiative**，不聊 Task。

---

## 4. 任务类型

| 类型 | 说明 | 路由 |
|------|------|------|
| `dev` | 开发任务 | US |
| `review` | 代码审查 | US |
| `qa` | 质量检查 | US |
| `audit` | 代码审计 | US |
| `exploratory` | 探索性开发 | US |
| `talk` | 沟通类 | HK |
| `research` | 调研类 | HK |
| `data` | 数据处理 | HK |

路由规则在 `task-router.js` 中定义。

---

## 5. 任务生命周期

```
1. 创建 (Create)
   ↓
2. 路由 (Route) — task-router.js
   - US: dev/review/qa/audit/exploratory
   - HK: talk/research/data
   ↓
3. 规划 (Plan) — planner.js
   - KR 轮转评分
   - 生成 PRD
   ↓
4. 派发 (Dispatch) — tick.js
   - 检查三池席位分配
   - 检查熔断器
   ↓
5. 执行 (Execute) — executor.js
   - 生成命令
   - 创建进程
   - 监控输出
   ↓
6. 监控 (Monitor) — watchdog.js
   - RSS/CPU 采样
   - 超时检测
   ↓
7. 结果处理
   ├─ 成功 → 记录熔断器成功
   ├─ 失败 → 分类 → 重试/隔离
   └─ 超时 → 杀进程 → 重入队列
```

---

## 6. PR Plan 工程规划层

Initiative 到 Task 之间有 PR Plan 作为工程规划层：

| 字段 | 说明 |
|------|------|
| `project_id` | 关联 Initiative |
| `title` | PR 标题 |
| `dod` | Definition of Done |
| `files` | 涉及文件 |
| `sequence` | 执行顺序 |
| `depends_on` | 依赖的 PR Plan |
| `complexity` | 复杂度 (low/medium/high) |

---

## 7. 数据库字段

### goals 表（OKR 三层）

```sql
id UUID PRIMARY KEY
parent_id UUID          -- 父级 OKR（嵌套）
project_id UUID         -- 关联 Project（可空）
type VARCHAR(50)        -- 'global_okr' | 'area_okr' | 'kr'
title VARCHAR(255)
progress INTEGER
status VARCHAR(50)
```

### projects 表（Project + Initiative）

```sql
id UUID PRIMARY KEY
parent_id UUID          -- 有值 = Initiative（父级是 Project）
name VARCHAR(255)
type VARCHAR(50)        -- 'project' | 'initiative'
```

### project_repos 表（多仓库关联）

```sql
project_id UUID         -- 关联 Project
repo_path VARCHAR(500)  -- 仓库路径
```

### pr_plans 表（工程规划）

```sql
id UUID PRIMARY KEY
project_id UUID         -- 关联 Initiative
title VARCHAR(255)
dod TEXT
files JSONB
sequence INTEGER
depends_on UUID[]
complexity VARCHAR(20)  -- 'low' | 'medium' | 'high'
```

### tasks 表

```sql
id UUID PRIMARY KEY
project_id UUID         -- 所属 Initiative
goal_id UUID            -- 关联 KR
pr_plan_id UUID         -- 关联 PR Plan（可空）
task_type VARCHAR(50)   -- dev/review/qa/audit/research/talk/data/exploratory
prd_content TEXT        -- PRD 内容
status VARCHAR(50)
```

---

## 8. 动态导航模式

**不提前拆 Task，边跑边生成**

```
Initiative 创建 → 只知道目标和验收条件
    ↓
执行 Task 1 → 看结果
    ↓
根据结果生成 Task 2 → 看结果
    ↓
... 循环 ...
    ↓
验收通过 → Initiative 完成
```

### planNextTask()

KR 轮转评分选择下一个任务，支持 `skipPrPlans` 选项：

```javascript
async function planNextTask(options = {}) {
  // 1. 评分所有活跃 KR
  // 2. 选择得分最高的 KR
  // 3. 在该 KR 下找 Initiative
  // 4. 生成 Task
}
```

---

## 9. 反馈汇总

按对话层级汇总：

```
你: "保护系统增强项目怎么样了" (Project 层)

Cecelia: Project「保护系统增强」进度 50%

         Initiative 1: 实现熔断器恢复 - 100%
         Initiative 2: 优化看门狗阈值 - 进行中
           - Task: 调整 RSS 阈值 [完成]
           - Task: 测试 CPU 告警 [进行中]
```

```
你: "KR1 进度" (KR 层)

Cecelia: KR1「派发成功率 > 90%」进度 60%

         Project 1: 保护系统增强 - 50%
         Project 2: 调度优化 - 100%
```
