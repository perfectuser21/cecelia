---
name: repo-visualizer
version: 1.0.0
description: Repository Architecture Visualizer - 生成仓库的可视化架构图
trigger: 可视化、architecture map、feature map、画图
---

# Repository Visualizer Skill

为任何代码仓库生成交互式架构可视化图。

## 核心理念

**系统化、可复现、基于事实的架构可视化。**

不能"随缘"定义组件，必须有明确的规则和标准。

## 使用场景

1. 理解新仓库的架构
2. 发现代码问题（过大文件、重复模块、依赖混乱）
3. 区分执行路径（LLM vs 纯代码、同步 vs 异步）
4. 识别重灾区，优先修复

## 工作流程

### Step 1: 定义组件（Component Definition）

**规则**：根据仓库类型确定"组件"的定义

| 仓库类型 | 组件定义 | 示例 |
|---------|---------|------|
| **Node.js 服务** | 顶层源文件 (`src/*.js`) | Brain: routes.js, tick.js, executor.js |
| **React 应用** | Feature 目录 (`src/features/*`) | Dashboard: dashboard/, today/, work/ |
| **Monorepo** | Package (`packages/*`) | Workspace: core/, brain/, workflows/ |
| **微服务** | Service 目录 (`services/*`) | - |

**输出**：组件清单（Component Inventory）

```bash
# 示例：Brain 仓库
find src -name "*.js" -type f -not -path "*/node_modules/*" -not -path "*/__tests__/*" | sort
```

### Step 2: 收集元数据（Metadata Collection）

为每个组件收集：

#### A. 基础信息
- **Name**: 组件名称
- **File**: 文件路径
- **Size**: 文件大小（用于识别过大文件）
- **Lines**: 行数（可选，更精确）

```bash
# 示例
ls -lh src/*.js | awk '{print $9, $5}'
```

#### B. 依赖分析
- **Imports**: 导入了哪些模块
- **Exports**: 导出了什么
- **Dependencies**: 依赖关系

```bash
# 检查是否使用 LLM
grep -l "anthropic\|claude\|openai" src/*.js
```

#### C. 功能分析
- **Purpose**: 通过文件头注释或 README 获取
- **Entry Points**: 是否是入口点（routes, main, index）
- **API Calls**: 是否调用外部 API

### Step 3: 分类标注（Classification）

#### 维度 1: 执行类型（Execution Type）

| 类型 | 定义 | 识别方法 | 颜色 |
|------|------|---------|------|
| **Code** | 纯代码逻辑，不调用 LLM | 无 LLM 导入 | 🔵 蓝色 |
| **LLM** | 调用大模型 API | 有 `anthropic`/`claude`/`openai` | 🟣 紫色 |
| **Async** | 异步任务（可选） | 有 `async`/`await`/`Promise` | 🟡 黄色 |

#### 维度 2: 健康状态（Health Status）

| 状态 | 定义 | 阈值 | 标记 |
|------|------|------|------|
| **Critical** | 严重问题，立即修复 | 文件 >100K 或已知严重 bug | 🔴 深红边框 |
| **Warning** | 需要优化 | 文件 30K-100K 或中度问题 | 🟠 粉红边框 |
| **Healthy** | 健康状态 | 正常范围 | 无边框 |

#### 维度 3: 架构分层（Architectural Layer）

根据仓库架构定义，例如：

**Brain 仓库（Node.js 服务）**：
- **Entry**: routes.js, websocket.js
- **Core**: tick.js, executor.js, thalamus.js, cortex.js
- **Service**: planner.js, decision.js, actions.js, alertness.js
- **Data**: db.js, event-bus.js

**React 应用**：
- **UI**: components/, pages/
- **State**: store/, context/
- **Logic**: hooks/, utils/
- **API**: api/, services/

### Step 4: 识别问题（Problem Detection）

#### 自动识别规则

| 问题类型 | 检测方法 | 优先级 |
|---------|---------|-------|
| **文件过大** | 文件 >100K | P0 |
| **分散模块** | 同名前缀的多个文件 | P0 |
| **功能重叠** | 相似命名但功能不清晰 | P1 |
| **循环依赖** | Import 分析（可选） | P1 |
| **测试覆盖低** | 无对应 test 文件 | P2 |

#### Brain 实际案例

```javascript
// 问题：分散模块
alertness.js (22K)
alertness-actions.js (9.7K)
alertness-decision.js (16K)
alertness/ (目录)
→ 解决方案：整合为统一模块

// 问题：功能重叠
cortex.js (25K)
cortex-quality.js (11K)
→ 解决方案：整合 quality 逻辑到 cortex

// 问题：文件过大
routes.js (167K)
→ 解决方案：拆分成 6 个路由文件
```

### Step 5: 生成可视化（Visualization Generation）

#### 使用模板

模板位置：`~/.claude/skills/repo-visualizer/templates/`

- `execution-paths.html` - 执行路径图（区分 LLM vs Code）
- `architecture-layers.html` - 架构分层图
- `problem-heatmap.html` - 问题热力图

#### 数据结构

```javascript
{
  nodes: [
    {
      id: 'routes',
      name: 'Routes\n路由层',
      x: 220, y: 400,
      type: 'code',        // code | llm | async
      health: 'critical',  // healthy | warning | critical
      layer: 'entry',      // entry | core | service | data
      size: 110,           // 节点大小
      file: 'src/routes.js',
      fileSize: '167K',
      description: 'Express 路由，接收并分发请求',
      problems: ['5326 行代码（过大）', '依赖 27 个模块'],
      solution: '拆分成 6 个独立的路由文件',
      time: '2-3 小时'
    }
  ],
  links: [
    {
      source: 'routes',
      target: 'thalamus',
      label: '复杂任务'  // 可选
    }
  ]
}
```

#### 可视化配置

```javascript
const typeColors = {
  'code': '#3b82f6',   // 蓝色
  'llm': '#a855f7',    // 紫色
  'async': '#f59e0b'   // 黄色
};

const healthBorders = {
  'healthy': { color: 'transparent', width: 0 },
  'warning': { color: '#fb7185', width: 3 },
  'critical': { color: '#dc2626', width: 5 }
};
```

### Step 6: 交互功能（Interactive Features）

必须实现：
- ✅ 点击节点显示详细信息
- ✅ 拖动和缩放
- ✅ 高亮关联节点
- ✅ 图例说明

可选功能：
- 🔲 搜索/过滤节点
- 🔲 切换视图（层级/类型/问题）
- 🔲 导出为图片/PDF

## 示例：Brain 仓库

### 执行命令

```bash
# 1. 进入 Brain 仓库
cd /home/xx/perfect21/cecelia/core/brain

# 2. 收集组件清单
find src -name "*.js" -type f -not -path "*/__tests__/*" -not -path "*/node_modules/*" | sort > /tmp/brain-components.txt

# 3. 收集元数据
ls -lh src/*.js | awk '{print $9, $5}' > /tmp/brain-sizes.txt

# 4. 识别 LLM 组件
grep -l "anthropic\|claude" src/*.js > /tmp/brain-llm.txt

# 5. 生成可视化
# 使用模板创建 HTML 文件
```

### 输出文件

```
/path/to/repo/docs/architecture/
├── brain-execution-paths.html      # 执行路径图
├── brain-components.json           # 组件元数据
└── brain-problems.md               # 问题清单
```

## 通用规则

### 1. 不能随缘

❌ **错误**：
- "感觉这个应该是 feature"
- "好像这几个文件相关"
- "大概这样分层吧"

✅ **正确**：
- 基于文件系统结构
- 基于 import/export 关系
- 基于实际代码分析
- 有明确的分类标准

### 2. 必须可复现

要求：
- 相同的仓库 → 相同的可视化
- 相同的规则 → 相同的分类
- 有文档记录所有决策

### 3. 问题识别要有依据

不能说"这个不好"，要说：
- "167K，超过 100K 阈值"
- "分散在 5 个文件，违反单一职责"
- "功能重叠，cortex 和 cortex-quality"

## 扩展

### 支持其他语言

| 语言 | 组件定义 | 元数据收集 |
|------|---------|-----------|
| Python | `*.py` 模块 | `find`, `wc -l` |
| Go | `*.go` package | `go list`, `go mod graph` |
| Java | `*.java` class | `find`, `jar tf` |
| TypeScript | `*.ts` 模块 | `tsc --listFiles` |

### 支持不同架构

- **Microservices**: 每个 service 是组件
- **Monorepo**: 每个 package 是组件
- **Plugin Architecture**: 每个 plugin 是组件

## 模板变量

所有模板支持以下变量：

```javascript
{
  repoName: 'Brain',
  repoPath: '/home/xx/perfect21/cecelia/core/brain',
  componentCount: 45,
  llmCount: 2,
  criticalCount: 1,
  warningCount: 5,
  timestamp: '2026-02-13',
  nodes: [...],
  links: [...]
}
```

## 总结

这个 Skill 的价值：
1. **系统化**：有明确的定义和分类标准
2. **可复现**：相同输入 → 相同输出
3. **自动化**：脚本驱动，减少人工判断
4. **可扩展**：支持多种语言和架构
5. **可视化**：直观展示架构和问题

**核心原则：基于事实，不靠猜测。**
