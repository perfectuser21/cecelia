# Cecelia Workflows

统一的 Cecelia 工作流定义仓库，支持多种工作流引擎。

## 目录结构

```
cecelia-workflows/
├── n8n/              # N8N workflows
│   ├── cecelia-launcher-v2.json
│   ├── cecelia-callback-handler.json
│   └── devgate-nightly-push.json
├── code/             # Code-based workflows
│   └── (未来添加)
├── scripts/          # 管理脚本
│   ├── sync-n8n.sh          # 同步 N8N workflows
│   ├── backup-from-n8n.sh   # 从 N8N 导出
│   └── deploy-to-n8n.sh     # 部署到 N8N
├── docs/             # 文档
│   ├── N8N_WORKFLOWS.md
│   └── ARCHITECTURE.md
└── README.md
```

## 核心原则

**这个仓库是唯一的工作流定义源**：
- ✅ 所有 workflows 定义存储在这里
- ✅ Git 版本控制
- ✅ 支持多种工作流引擎（N8N、代码、Temporal 等）
- ❌ 不包含运行时环境

## 工作流类型

### N8N Workflows (`n8n/`)

使用 N8N 可视化编排的工作流：
- Cecelia Launcher - 启动 Cecelia 任务
- Callback Handler - 处理执行回调
- DevGate Nightly Push - 夜间构建推送

### Code Workflows (`code/`)

使用代码定义的工作流（未来添加）：
- TypeScript workflows
- Python workflows
- 其他语言实现的工作流

## 部署

### N8N Workflows

```bash
# 从 N8N 导出（备份）
./scripts/backup-from-n8n.sh

# 部署到 N8N
./scripts/deploy-to-n8n.sh
```

### 使用 n8n-manage skill

```bash
# 在 Claude Desktop 中
"帮我从 N8N 备份所有 workflows"
```

## 数据流

```
cecelia-workflows (Git)
    ↓
N8N Container / Cecelia Bridge
    ↓
Cecelia-OS / autopilot (只展示)
```

## 相关项目

- **Cecelia-OS**: Core system (只通过 API 展示 N8N 状态)
- **autopilot**: Dashboard (只通过 API 展示 N8N 状态)
- **n8n-self-hosted**: Docker container (运行时)

## 维护

所有 workflow 修改：
1. 在 N8N 界面编辑 workflow
2. 运行 `./scripts/backup-from-n8n.sh` 导出
3. Git commit + push
4. 或者直接编辑 JSON 文件，然后运行 `./scripts/deploy-to-n8n.sh`
