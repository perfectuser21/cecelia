# Cecelia Workflows

**N8N Workflows 的版本控制仓库**

这个仓库专注于管理 N8N workflow 定义（JSON），作为 workflow repository。

## 职责定位

**✅ 这个仓库包含**：
- 所有 N8N workflow 定义（JSON 文件）
- 能力映射配置（capability_mapping.json）
- 导出/导入脚本
- 版本管理和文档

**❌ 不包含**（应该在 cecelia-workspace）：
- 前端界面
- 执行监控和日志
- QA 测试
- 状态管理
- 用户权限管理

## 目录结构

```
cecelia-workflows/
├── n8n/
│   ├── workflows/                     # 所有 workflow JSON 文件（按分类）
│   │   ├── cecelia/                   # Cecelia 相关 (5 个)
│   │   ├── media/                     # 自媒体相关 (11 个)
│   │   └── tools/                     # 基础工具 (8 个)
│   ├── capability_mapping.json        # 能力映射配置
│   ├── templates/                     # 模板库
│   └── archive/                       # 归档
├── scripts/
│   ├── export-from-n8n.sh             # 从 N8N 导出
│   └── import-to-n8n.sh               # 导入到 N8N
├── docs/
│   └── ARCHITECTURE.md
└── README.md
```

## 当前 Workflows

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

### 添加新能力
```bash
1. 在 N8N 创建新 workflows
2. 更新 n8n/capability_mapping.json
3. 导出: ./scripts/export-from-n8n.sh
4. Git commit 和 push
5. cecelia-workspace 自动显示新能力
```

### 恢复 workflow
```bash
1. Git checkout 到历史版本
2. 导入: ./scripts/import-to-n8n.sh
```

## 与 cecelia-workspace 的接口

cecelia-workspace 通过以下方式使用这个仓库：

1. **读取能力映射**
   ```javascript
   // 从 Git 或 CDN 读取
   const capabilities = await fetch(
     'https://raw.githubusercontent.com/.../n8n/capability_mapping.json'
   ).then(r => r.json());
   ```

2. **触发 workflow 执行**
   ```javascript
   // 直接调用 N8N API
   const result = await fetch('http://localhost:5679/api/v1/workflows/{id}/execute', {
     method: 'POST',
     headers: { 'X-N8N-API-KEY': API_KEY }
   });
   ```

3. **不需要访问**这个仓库的其他部分

## 架构关系

```
┌─────────────────────────────────┐
│  cecelia-workspace              │
│  (前端/管理/QA/监控)             │
└─────────────────────────────────┘
           ↓ N8N API
┌─────────────────────────────────┐
│  N8N (localhost:5679)           │
│  (执行引擎)                      │
└─────────────────────────────────┘
           ↑ Git Sync
┌─────────────────────────────────┐
│  cecelia-workflows (本仓库)     │
│  (版本控制)                      │
└─────────────────────────────────┘
```

## 版本管理

- **主分支**: 生产环境 workflows
- **标签**: 重大更新打 tag（如 v1.2.0）
- **提交规范**:
  ```
  feat: 添加抖音数据爬取 workflow
  fix: 修复头条发布失败问题
  docs: 更新能力映射文档
  ```
