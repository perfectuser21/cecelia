# Cecelia Workflows

> n8n 已停用。本目录保留其历史工作流和说明，不作为现役任务执行或 CI 入口；以下旧导入、恢复步骤仅供追溯。旧能力映射产物及生成器已清退，现役任务和流程经 Brain 登记。

**Workflows + Staff 统一管理仓库（HR 部门）**

这个仓库管理 Cecelia 系统的两大核心资源：
- **Workflows** - N8N 工作流程定义（SOP）
- **Staff** - 员工/Agent 配置（人员）

## 职责定位

**✅ 这个仓库包含**：
- 所有 N8N workflow 定义（JSON 文件）
- 员工配置（workers.config.json）
- 导出/导入脚本
- 版本管理和文档

**❌ 不包含**（在 cecelia-workspace）：
- 前端界面（只读取本仓库配置显示）
- 执行监控和日志
- 状态管理

## 目录结构

```
cecelia-workflows/
├── n8n/                               # 工作流程 (Workflows)
│   ├── workflows/                     # 所有 workflow JSON 文件
│   │   ├── cecelia/                   # Cecelia 相关
│   │   ├── media/                     # 自媒体相关
│   │   └── tools/                     # 基础工具
│   ├── templates/                     # 模板库
│   └── archive/                       # 归档
│
├── staff/                             # 员工管理 (Staff)
│   └── workers.config.json            # 部门和员工配置
│
├── scripts/
│   ├── export-from-n8n.sh             # 从 N8N 导出
│   └── import-to-n8n.sh               # 导入到 N8N
├── docs/
│   └── ARCHITECTURE.md
└── README.md
```

## Staff 员工配置

### 部门架构

| 部门 | 员工 | 角色 | 职责 |
|------|------|------|------|
| **研发部** | Spark (小火) | 执行者 | 解析 PRD，调用 Claude Code |
| | Echo (小回) | 协调者 | 监控状态，处理多阶段任务 |
| | Prism (小棱) | 分析者 | 多维度分析结果 (planned) |
| **新媒体部** | 小运 | 内容运营 | 账号登录、内容发布 |
| | 小析 | 数据分析 | 各平台数据采集分析 |
| **运维部** | 小维 | 系统运维 | 定时任务、监控、清理 |
| **集成部** | 小通 | 系统集成 | Notion 同步、Webhook 处理 |

### 员工与 Workflow 关联

每个员工通过 `n8nKeywords` 关联到相应的 N8N workflows。

## 历史 Workflows

### 📁 Cecelia (5 个)
- [Flow] Cecelia 任务启动器
- [Flow] DevGate 每夜推送
- [Unit] Cecelia 回调处理
- [Unit] Claude Code 异步执行
- [Unit] Claude HTTP 触发器

### 📁 自媒体 (11 个)
- [Flow] 数据采集调度器
- [Flow] 内容发布
- [Flow] Notion到头条发布
- [Unit] 7 个平台数据爬取

### 📁 基础工具 (8 个)
- [Flow] 夜间任务调度器
- [Unit] 健康检查、备份、Webhook 等

## 工作流程

### 更新 workflow
```bash
1. 在 N8N 界面修改 workflow
2. 导出: ./scripts/export-from-n8n.sh
3. Git commit 和 push
```

### 新能力登记

本目录不再生成 n8n 能力映射。Cecelia 的现役任务与 Workflow 通过 Brain 登记，当前检查和发布入口见 [CI/CD 说明](../../docs/current/CI_PIPELINE.md)。

### 恢复 workflow
```bash
1. Git checkout 到历史版本
2. 导入: ./scripts/import-to-n8n.sh
```

## 与 cecelia-workspace 的接口

cecelia-workspace 通过以下方式使用这个仓库：

1. **读取员工配置**（通过 symlink）
   ```
   cecelia-workspace/apps/core/data/workers/workers.config.json
     → symlink → cecelia-workflows/staff/workers.config.json
   ```

2. **触发 workflow 执行**
   ```javascript
   // 直接调用 N8N API
   const result = await fetch('http://localhost:5679/api/v1/workflows/{id}/execute', {
     method: 'POST',
     headers: { 'X-N8N-API-KEY': API_KEY }
   });
   ```

## 架构关系

```
┌─────────────────────────────────────┐
│  cecelia-workspace                  │
│  (前端显示 / 状态管理)              │
│                                     │
│  symlink → staff/workers.config.json│
└─────────────────────────────────────┘
           ↓ N8N API
┌─────────────────────────────────────┐
│  N8N (localhost:5679)               │
│  (执行引擎)                         │
└─────────────────────────────────────┘
           ↑ Git Sync
┌─────────────────────────────────────┐
│  cecelia-workflows (本仓库)         │
│  HR 部门：Workflows + Staff         │
│  - n8n/          工作流程定义       │
│  - staff/        员工配置           │
└─────────────────────────────────────┘
```

**数据流向**：
- 本仓库定义 workflows 和 staff 配置
- cecelia-workspace 通过 symlink 读取 staff 配置
- 前端只负责显示，配置统一在本仓库管理

## 版本管理

- **主分支**: 生产环境 workflows
- **标签**: 重大更新打 tag（如 v1.2.0）
- **提交规范**:
  ```
  feat: 添加抖音数据爬取 workflow
  fix: 修复头条发布失败问题
  docs: 更新能力映射文档
  ```
