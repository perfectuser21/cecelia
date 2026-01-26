---
id: features
version: 2.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 2.0.0: 重构为专业三层分类（Foundation/Business/Platform）
  - 1.0.0: 初始版本
---

# ZenithJoy Workspace - Feature 能力地图

> 基于 DDD 领域驱动设计的三层分类体系
>
> 支持 RCI、Golden Paths 和回归测试
>
> 最后更新：2026-01-26

---

## 分类体系说明

### 三层架构

```
┌─────────────────────────────────────────────────────────┐
│                   Business Features                      │
│              (业务功能层 - 直接产生业务价值)                │
│  新媒体运营、AI 员工、账号管理、工作台                      │
└─────────────────────────────────────────────────────────┘
                            ↓ 依赖
┌─────────────────────────────────────────────────────────┐
│                   Platform Features                      │
│              (平台功能层 - 支撑工具和服务)                  │
│  系统监控、任务管理、工作流管理、画布                        │
└─────────────────────────────────────────────────────────┘
                            ↓ 依赖
┌─────────────────────────────────────────────────────────┐
│                  Foundation Features                     │
│              (基础功能层 - 所有功能共享)                    │
│  认证、通知、日志                                          │
└─────────────────────────────────────────────────────────┘
```

### 分类标准

| 层级 | 定义 | 用户 | RCI 策略 | 优先级 |
|------|------|------|---------|--------|
| **Business** | 直接为业务目标服务，产生业务价值 | 业务团队、客户 | 必须有 Golden Paths | P0-P1 |
| **Platform** | 支撑业务运行的工具和服务 | 内部团队、开发者 | 关键路径需要覆盖 | P1-P2 |
| **Foundation** | 所有功能共享的基础能力 | 所有 features | 任何破坏都是阻塞性 | P0 |

### Feature 属性定义

每个 Feature 包含以下属性：

```yaml
feature:
  id: F-XXX              # Feature ID
  name: "功能名称"
  category: Business     # Business / Platform / Foundation
  instances: [autopilot] # autopilot / core / both
  owner: "负责人/团队"
  priority: P0           # P0(critical) / P1(high) / P2(medium) / P3(low)
  has_rci: true         # 是否有 RCI 契约
  has_golden_path: true # 是否有 Golden Path
  dependencies: []       # 依赖的其他 features
  routes: []            # 前端路由
  apis: []              # 后端 API
```

---

## Foundation Features（基础功能层）

### F-AUTH: 飞书认证

**基础信息**：
- **Category**: Foundation
- **Instances**: [autopilot, core]
- **Owner**: 认证团队
- **Priority**: P0
- **Has RCI**: true
- **Has Golden Path**: true

**功能描述**：
- 飞书扫码登录
- 飞书一键登录
- Token 自动刷新
- 会话管理

**路由**：
- `/login` - 飞书登录页

**Evidence**: `apps/dashboard/frontend/src/pages/FeishuLogin.tsx`

**RCI 契约**：
```yaml
- RCI-F-001: 飞书登录必须可用
- RCI-F-002: Token 刷新机制不能失效
- RCI-F-003: 会话过期后必须能重新登录
```

**Golden Path**：
```
GP-AUTH-001: 用户扫码 → 授权 → 获取 Token → 进入系统
GP-AUTH-002: Token 过期 → 自动刷新 → 继续使用
```

**Dependencies**: 无

---

### F-NOTIFICATION: 通知系统

**基础信息**：
- **Category**: Foundation
- **Instances**: [autopilot, core]
- **Owner**: 基础设施团队
- **Priority**: P1
- **Has RCI**: false
- **Has Golden Path**: false

**功能描述**：
- 系统通知
- 任务完成通知
- 错误告警通知

**Evidence**: `apps/dashboard/core/api/src/features/notifications/`

**Dependencies**: 无

---

### F-LOGS: 日志系统

**基础信息**：
- **Category**: Foundation
- **Instances**: [autopilot, core]
- **Owner**: 基础设施团队
- **Priority**: P1
- **Has RCI**: false
- **Has Golden Path**: false

**功能描述**：
- 系统日志记录
- 日志查询
- 日志聚合

**Evidence**: `apps/dashboard/core/api/src/features/infra/logs/`

**APIs**：
- `GET /api/logs` - 查询日志

**Dependencies**: 无

---

## Business Features（业务功能层）

> 所有 Business Features 属于 Autopilot 实例

---

### F-WORKBENCH: 工作台

**基础信息**：
- **Category**: Business
- **Instances**: [autopilot]
- **Owner**: 业务团队
- **Priority**: P2
- **Has RCI**: false
- **Has Golden Path**: false

**功能描述**：
- 业务首页仪表盘
- 每日一言
- 节日问候
- 业务概览

**路由**：
- `/` - 工作台首页

**Evidence**: `apps/dashboard/frontend/src/pages/Dashboard.tsx`

**Dependencies**:
- F-AUTH (需要登录)

---

### F-MEDIA: 新媒体运营

**基础信息**：
- **Category**: Business
- **Instances**: [autopilot]
- **Owner**: 内容运营团队
- **Priority**: P0
- **Has RCI**: true
- **Has Golden Path**: true

**功能描述**：
核心业务功能，内容采集、发布、数据分析全流程

**子功能**：

#### F-MEDIA-ENTRY: 场景入口
- **路由**: `/media`
- **组件**: MediaScenarioPage
- **功能**: 新媒体运营场景主入口，展示整体流程

#### F-MEDIA-CONTENT: 内容管理
- **路由**: `/media/content`
- **组件**: ContentData
- **功能**: 管理待发布内容，内容编辑、分类、标签

#### F-MEDIA-COLLECT: 内容采集
- **路由**: `/media/content/scraping`
- **组件**: ScrapingPage
- **功能**: 从各平台采集内容（小红书、抖音、B站、微博）

#### F-MEDIA-PUBLISH: 发布管理
- **路由**: `/media/publish`
- **组件**: ContentPublish
- **功能**: 发布任务队列，管理发布计划

#### F-MEDIA-HISTORY: 执行历史
- **路由**: `/media/publish/history`
- **组件**: ExecutionStatus
- **功能**: 发布执行记录，查看发布结果

#### F-MEDIA-PLATFORMS: 平台状态
- **路由**: `/media/publish/platforms`
- **组件**: PlatformStatus（待实现）
- **功能**: 各平台账号状态，监控平台可用性

#### F-MEDIA-ANALYTICS: 数据分析
- **路由**: `/media/data`
- **组件**: PublishStats
- **功能**: 发布效果数据，数据可视化分析

**Evidence**:
- `apps/dashboard/frontend/src/config/navigation.config.ts:L94-99`
- `apps/dashboard/frontend/src/pages/MediaScenarioPage.tsx`

**业务流程**：
```
采集内容 (F-MEDIA-COLLECT)
    → 内容管理 (F-MEDIA-CONTENT)
    → 发布管理 (F-MEDIA-PUBLISH)
    → 执行历史 (F-MEDIA-HISTORY) + 平台状态 (F-MEDIA-PLATFORMS)
    → 数据分析 (F-MEDIA-ANALYTICS)
```

**RCI 契约**：
```yaml
- RCI-B-001: 小红书采集功能不能中断
- RCI-B-002: 采集数据格式必须保持一致
- RCI-B-003: 发布任务不能丢失
- RCI-B-004: 发布状态追踪必须准确
- RCI-B-005: 数据统计必须准确（不能有偏差）
```

**Golden Paths**：
```
GP-MEDIA-001: 采集 → 保存 → 发布完整流程
  1. 用户在采集页输入平台链接
  2. 系统采集内容并保存到内容库
  3. 用户在发布管理创建发布任务
  4. 系统执行发布并更新状态
  5. 用户在数据分析查看效果

GP-MEDIA-002: 内容编辑 → 多平台发布流程
  1. 用户在内容管理编辑内容
  2. 选择多个平台发布
  3. 系统分别发布到各平台
  4. 查看各平台发布结果
```

**Dependencies**:
- F-AUTH (需要登录)
- F-ACCOUNTS (需要账号授权)
- F-NOTIFICATION (发布完成通知)

---

### F-AI-EMPLOYEES: AI 员工系统

**基础信息**：
- **Category**: Business
- **Instances**: [autopilot]
- **Owner**: AI 团队
- **Priority**: P1
- **Has RCI**: true
- **Has Golden Path**: true

**功能描述**：
将 n8n 工作流抽象为"AI 员工"概念，提供用户友好视图

**概念定义**：
- **AI 员工** = 一组相关的 n8n workflows
- **能力** = 单个 workflow
- **示例**: 内容运营员工 → 能力：采集、编辑、发布

**子功能**：

#### F-AI-EMPLOYEES-LIST: 员工列表
- **路由**: `/ai-employees`
- **组件**: AiEmployeesPage
- **功能**: 查看所有 AI 员工

#### F-AI-EMPLOYEES-DETAIL: 员工详情
- **路由**: `/ai-employees/:id`
- **组件**: AiEmployeeDetailPage
- **功能**: 查看单个员工能力和配置

#### F-AI-EMPLOYEES-ABILITY: 能力详情
- **路由**: `/ai-employees/:id/abilities/:aid`
- **组件**: AiAbilityDetailPage
- **功能**: 查看具体能力说明和执行历史

**Evidence**:
- `apps/dashboard/frontend/src/config/navigation.config.ts:L100-106`
- `apps/dashboard/frontend/src/pages/AiEmployeesPage.tsx`

**RCI 契约**：
```yaml
- RCI-B-010: AI 员工列表必须能加载
- RCI-B-011: 员工详情页能力展示不能错误
- RCI-B-012: 能力执行记录不能丢失
```

**Golden Paths**：
```
GP-AI-001: 查看员工 → 选择能力 → 执行任务
  1. 用户进入 AI 员工列表
  2. 点击某个员工查看详情
  3. 选择一个能力执行
  4. 查看执行结果
```

**Dependencies**:
- F-AUTH (需要登录)
- F-NOTIFICATION (任务完成通知)

---

### F-ACCOUNTS: 账号管理

**基础信息**：
- **Category**: Business
- **Instances**: [autopilot]
- **Owner**: 账号管理团队
- **Priority**: P0
- **Has RCI**: true
- **Has Golden Path**: true

**功能描述**：
管理社交媒体平台账号，查看账号数据

**支持平台**：
- 小红书 (xiaohongshu)
- 抖音 (douyin)
- B站 (bilibili)
- 微博 (weibo)

**子功能**：

#### F-ACCOUNTS-LIST: 账号列表
- **路由**: `/accounts`
- **组件**: AccountsList
- **功能**: 查看所有平台账号

#### F-ACCOUNTS-METRICS: 账号数据
- **路由**: `/accounts/:id/metrics`
- **组件**: AccountMetrics
- **功能**: 单个账号的数据分析（粉丝、互动、增长趋势）

**Evidence**:
- `apps/dashboard/frontend/src/pages/accounts/AccountsList.tsx`
- `apps/dashboard/frontend/src/pages/accounts/AccountMetrics.tsx`

**RCI 契约**：
```yaml
- RCI-B-020: 账号列表必须能加载
- RCI-B-021: 账号授权状态必须准确
- RCI-B-022: 账号数据统计不能有偏差
```

**Golden Paths**：
```
GP-ACCOUNTS-001: 添加账号 → 授权 → 查看数据
  1. 用户在账号列表点击添加
  2. 选择平台并授权
  3. 系统保存账号信息
  4. 用户查看账号数据

GP-ACCOUNTS-002: 查看账号数据 → 分析趋势
  1. 用户进入账号列表
  2. 点击某个账号查看详情
  3. 查看粉丝增长、互动数据
  4. 分析内容效果
```

**Dependencies**:
- F-AUTH (需要登录)

---

## Platform Features（平台功能层）

> 所有 Platform Features 属于 Core 实例（zenithjoy-core）

---

### F-MONITOR-CLAUDE: Claude 监控

**基础信息**：
- **Category**: Platform
- **Instances**: [core]
- **Owner**: 运维团队
- **Priority**: P1
- **Has RCI**: true
- **Has Golden Path**: false

**功能描述**：
- 监控 Claude Code 使用情况
- Token 消耗统计
- 会话历史查询
- 成本分析

**Evidence**: 原 `apps/dashboard/frontend/src/pages/settings/ClaudeMonitor.tsx`（已迁移）

**RCI 契约**：
```yaml
- RCI-P-001: 监控数据收集不能中断
- RCI-P-002: Token 消耗统计必须准确
```

**Dependencies**:
- F-AUTH (需要登录)
- F-LOGS (依赖日志系统)

---

### F-MONITOR-VPS: VPS 监控

**基础信息**：
- **Category**: Platform
- **Instances**: [core]
- **Owner**: 运维团队
- **Priority**: P1
- **Has RCI**: true
- **Has Golden Path**: false

**功能描述**：
- VPS 资源监控（CPU、内存、磁盘）
- Docker 容器状态
- 服务健康检查
- 告警通知

**Evidence**: 原 `apps/dashboard/frontend/src/pages/settings/VpsMonitor.tsx`（已迁移）

**RCI 契约**：
```yaml
- RCI-P-010: VPS 状态监控不能中断
- RCI-P-011: 告警通知必须及时触发
```

**Dependencies**:
- F-AUTH (需要登录)
- F-NOTIFICATION (告警通知)

---

### F-N8N-MANAGE: N8N 工作流管理

**基础信息**：
- **Category**: Platform
- **Instances**: [core]
- **Owner**: 自动化团队
- **Priority**: P1
- **Has RCI**: true
- **Has Golden Path**: true

**功能描述**：
- 查看所有 N8N workflows
- 创建 webhook workflow
- 测试 webhook
- 删除 workflow
- 查看执行历史

**Evidence**:
- 原 Settings 页面 N8N 管理部分（已迁移）
- `~/.claude/skills/n8n-manage/` skill

**RCI 契约**：
```yaml
- RCI-P-020: Workflow 列表必须能加载
- RCI-P-021: Webhook 创建不能失败
- RCI-P-022: Workflow 执行历史不能丢失
```

**Golden Paths**：
```
GP-N8N-001: 创建 Webhook Workflow
  1. 用户进入 N8N 管理页
  2. 点击创建 webhook workflow
  3. 配置 workflow 参数
  4. 测试 webhook
  5. 激活 workflow
```

**Dependencies**:
- F-AUTH (需要登录)

---

### F-CANVAS: Canvas 画布

**基础信息**：
- **Category**: Platform
- **Instances**: [core]
- **Owner**: 可视化团队
- **Priority**: P2
- **Has RCI**: false
- **Has Golden Path**: false

**功能描述**：
- 可视化画布工具
- 项目架构图绘制
- Feature → Module → Logic → Code 四层架构展示
- 支持导出和分享

**Evidence**: 原 `apps/dashboard/frontend/src/pages/settings/Canvas.tsx`（已迁移）

**Dependencies**:
- F-AUTH (需要登录)

---

### F-CECELIA: Cecelia 任务管理

**基础信息**：
- **Category**: Platform
- **Instances**: [core]
- **Owner**: Cecelia 团队
- **Priority**: P1
- **Has RCI**: true
- **Has Golden Path**: true

**功能描述**：
Cecelia 无头开发系统的可视化管理界面

**子功能**：

#### F-CECELIA-TASKS: 任务列表
- **功能**: 查看所有 Cecelia 任务
- **数据来源**: Core API (`/api/cecelia/overview`)

#### F-CECELIA-RUN: Run 详情
- **功能**: 单个 Run 的详细信息
- **数据来源**: Core API (`/api/cecelia/runs/:id`)

#### F-CECELIA-CHECKPOINT: Checkpoint 进度
- **功能**: 查看 10 步 Checkpoint 进度
- **数据来源**: Core API (`/api/cecelia/checkpoints/:id`)

**Evidence**: `apps/cecelia-frontend/` (🚧 开发中)

**Core API 端点**：
```
POST   /api/cecelia/runs              # 创建任务
GET    /api/cecelia/runs/:id          # 获取任务详情
PATCH  /api/cecelia/runs/:id/status   # 更新任务状态
PATCH  /api/cecelia/checkpoints/:id   # 更新 Checkpoint
GET    /api/cecelia/overview          # 获取概览
```

**RCI 契约**：
```yaml
- RCI-P-030: 任务状态追踪不能丢失
- RCI-P-031: Checkpoint 进度必须准确
- RCI-P-032: Run 详情查询不能失败
```

**Golden Paths**：
```
GP-CECELIA-001: 创建任务 → 执行 → 完成
  1. 系统接收任务（N8N 或 webhook）
  2. Cecelia Runner 执行 10 步流程
  3. 每步更新 Checkpoint 状态
  4. 完成后同步到 Core + Notion
  5. 用户在前端查看结果
```

**Dependencies**:
- F-AUTH (需要登录)
- F-NOTIFICATION (任务完成通知)

---

## 非 Feature 组件

> 以下是技术组件和开发工具，**不属于 Feature**，不纳入 RCI 和 Golden Path 体系

### Development Infrastructure（开发基础设施）

#### Cecelia Engine
- **位置**: `/home/xx/bin/cecelia-run`, `cecelia-api`, `cecelia-batch`
- **定义**: 无头 Claude Code 执行引擎
- **公式**: `Cecelia = claude -p "/dev + PRD" --output-format json`
- **流程**:
  ```
  触发 → cecelia-run → 获取并发锁 (max 3)
                     → claude -p "/dev ..." --output-format json
                     → /dev Skill 加载 → Engine 10 步流程
                     → cecelia-api 更新 Core + 同步 Notion
                     → 输出 JSON 结果
                     → 释放锁
  ```

#### Claude Skills
- **位置**: `~/.claude/skills/`
- **定义**: AI 能力工具集，用于质检、开发、审计
- **类型**:
  - 开发 Skills: `/dev`, `/audit`, `/qa`
  - 设计 Skills: `/frontend-design`, `/chrome`
  - 管理 Skills: `/credentials`, `/github-protection`, `/semver`
  - 内容 Skills: `/luxury-card-generator`, `/batch-notion-analyzer`

#### Task Dispatcher
- **位置**: N8N workflow "Task Dispatcher v2.0"
- **定义**: 任务调度系统，5分钟轮询 Notion 任务
- **流程**:
  ```
  Notion 创建任务 (Status: 待执行)
       ↓
  N8N 每 5 分钟轮询
       ↓
  调用 cecelia-run
       ↓
  更新 Core + Notion 状态
  ```

### Technical Components（技术组件）

#### N8N Workflows
- **位置**: N8N Server (Docker: n8n-self-hosted)
- **定义**: 工作流引擎，所有自动化任务的执行平台
- **访问**: http://localhost:5678 (内部)

#### Platform Scraper
- **位置**: `workflows/platform-scraper/`
- **定义**: Playwright 采集脚本，支持小红书、抖音、B站

#### Platform Session
- **位置**: `workflows/platform-session/`
- **定义**: 平台会话管理，维护平台登录状态

### Infrastructure（基础设施）

#### Database
- **Core DB**: `apps/cecelia-frontend/database/` (SQLite)
- **Business DB**: TBD (Autopilot 业务数据库)

#### File Storage
- **Uploads**: `apps/cecelia-frontend/data/uploads/`
- **Processed**: `apps/cecelia-frontend/data/uploads/processed/`

---

## Feature 统计

### 按层级统计

| 层级 | Features 数 | 子功能数 | 状态 |
|------|-------------|---------|------|
| Foundation | 3 | 3 | ✅ Done |
| Business | 4 | 17 | ✅ Done |
| Platform | 5 | 10 | 🚧 1 In Progress |
| **总计** | **12** | **30** | |

### 按实例统计

| 实例 | Features 数 | 状态 |
|------|-------------|------|
| Autopilot | 4 | ✅ Done |
| Core | 5 | 🚧 1 In Progress |
| Both (Shared) | 3 | ✅ Done |
| **总计** | **12** | |

### 按优先级统计

| 优先级 | Features 数 | 说明 |
|--------|-------------|------|
| P0 | 4 | Critical - F-AUTH, F-MEDIA, F-ACCOUNTS, F-WORKBENCH |
| P1 | 6 | High - F-AI-EMPLOYEES, F-MONITOR-*, F-N8N-MANAGE, F-CECELIA |
| P2 | 2 | Medium - F-NOTIFICATION, F-CANVAS |
| P3 | 0 | Low |

### RCI 和 Golden Path 覆盖率

| 指标 | 数量 | 占比 |
|------|------|------|
| 有 RCI 契约 | 9 / 12 | 75% |
| 有 Golden Path | 6 / 12 | 50% |

---

## 依赖关系图

```
Foundation Features (3)
    ↓
    ├── F-AUTH ──────────┐
    │                   │
    ├── F-NOTIFICATION ──┤
    │                   │
    └── F-LOGS ──────────┤
                        ↓
Business Features (4)           Platform Features (5)
                        ↓               ↓
    ┌─────────────────┴─────────────────────┐
    │                                       │
    ├── F-WORKBENCH                         ├── F-MONITOR-CLAUDE
    │       └── depends: F-AUTH             │       └── depends: F-AUTH, F-LOGS
    │                                       │
    ├── F-MEDIA                             ├── F-MONITOR-VPS
    │       ├── depends: F-AUTH             │       └── depends: F-AUTH, F-NOTIFICATION
    │       ├── depends: F-ACCOUNTS         │
    │       └── depends: F-NOTIFICATION     ├── F-N8N-MANAGE
    │                                       │       └── depends: F-AUTH
    ├── F-AI-EMPLOYEES                      │
    │       ├── depends: F-AUTH             ├── F-CANVAS
    │       └── depends: F-NOTIFICATION     │       └── depends: F-AUTH
    │                                       │
    └── F-ACCOUNTS                          └── F-CECELIA
            └── depends: F-AUTH                     ├── depends: F-AUTH
                                                    └── depends: F-NOTIFICATION
```

---

## 仓库信息

| 项目 | 值 |
|------|-----|
| RepoType | **Workspace** (包含多个子系统) |
| 主要子系统 | Autopilot (Business), Core (Platform), Cecelia (Engine) |
| 技术栈 | React + Vite + TypeScript + Node.js + Docker |
| 分支策略 | main (稳定) ← develop (开发) ← cp-* (功能分支) |

---

## 项目架构

```
zenithjoy-core (Core 实例 - Platform Features)
     ↑ 引用
     │
cecelia-workspace (本仓库 - Workspace)
     │
     ├── apps/
     │   ├── dashboard/
     │   │   ├── frontend/     (Autopilot + Core 共享前端)
     │   │   └── core/api/     (Backend API)
     │   │
     │   └── cecelia-frontend/ (F-CECELIA: Cecelia 可视化)
     │
     ├── features/              (Feature 代码目录 - 逻辑归档)
     │   ├── autopilot/         (Autopilot 专属)
     │   ├── shared/            (共享组件)
     │   ├── dev/               (开发工具)
     │   └── research/          (研究项目)
     │
     ├── workflows/             (非 Feature - 技术组件)
     │   ├── platform-scraper/  (采集脚本)
     │   └── platform-session/  (会话管理)
     │
     └── /home/xx/bin/          (非 Feature - 开发基础设施)
         ├── cecelia-run        (Cecelia Engine)
         ├── cecelia-api        (状态管理)
         └── ...
```

---

## 下一步

### 高优先级
- [ ] 完成 F-CECELIA 前端界面（🚧 开发中）
- [ ] 为 F-MEDIA 定义完整的 Flow Contract RCI
- [ ] 为所有 P0/P1 Features 补充 Golden Paths 测试

### 中优先级
- [ ] 补充所有 Features 的 Unit 测试
- [ ] 文档化所有 Feature APIs
- [ ] 统一错误处理和通知机制

### 低优先级
- [ ] Performance 优化
- [ ] 国际化支持
- [ ] 主题系统扩展

---

## 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-01-26 | 2.0.0 | 重构为专业三层分类（Foundation/Business/Platform），支持 RCI |
| 2026-01-26 | 1.0.0 | 初始版本（技术组件混合） |
| 2026-01-22 | - | N8N 迁移到 zenithjoy-core |
| 2026-01-21 | - | 系统监控功能迁移到 Core |

---

*本文档基于 DDD 领域驱动设计原则编写，支持 RCI、Golden Paths 和回归测试体系*
