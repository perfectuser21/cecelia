# Cecelia Workflows 架构

## 设计原则

### 单一数据源（Single Source of Truth）

```
cecelia-workflows (Git Repo)
    ↓ 唯一的定义源
运行时环境 (N8N / Bridge / Workers)
    ↓ 只负责执行
Dashboard (Cecelia-OS / autopilot)
    ↓ 只负责展示
```

### 关注点分离（Separation of Concerns）

| 层级 | 职责 | 不做什么 |
|------|------|----------|
| **cecelia-workflows** | 定义 workflows，版本控制 | ❌ 不运行 |
| **N8N Container** | 执行 N8N workflows | ❌ 不是数据源 |
| **Cecelia Bridge** | 执行代码 workflows | ❌ 不存储定义 |
| **Cecelia-OS** | 展示状态，API 代理 | ❌ 不管理 workflows |
| **autopilot** | 展示状态，API 代理 | ❌ 不管理 workflows |

## 数据流

### N8N Workflows

```
┌─────────────────────────────────────────────────────────────┐
│                开发/修改 N8N Workflow                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  方式 1: 在 N8N 界面编辑                                     │
│    https://n8n.zenjoymedia.media                           │
│    ↓                                                        │
│    运行 backup-from-n8n.sh                                  │
│    ↓                                                        │
│    git commit + push                                        │
│                                                             │
│  方式 2: 直接编辑 JSON                                       │
│    编辑 cecelia-workflows/n8n/*.json                        │
│    ↓                                                        │
│    运行 deploy-to-n8n.sh                                    │
│    ↓                                                        │
│    git commit + push                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Code Workflows (未来)

```
┌─────────────────────────────────────────────────────────────┐
│                开发 Code Workflow                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  编辑 cecelia-workflows/code/*.ts                           │
│    ↓                                                        │
│  运行 deploy-code.sh                                        │
│    ↓                                                        │
│  部署到 Cecelia Bridge / Workers                            │
│    ↓                                                        │
│  git commit + push                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 运行时架构

```
                    ┌─────────────────────┐
                    │   Trigger Source    │
                    │  (Webhook / Cron)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
    ┌──────────────────┐            ┌──────────────────┐
    │  N8N Container   │            │  Direct Webhook  │
    │  (localhost:5679)│            │   to Bridge      │
    └────────┬─────────┘            └────────┬─────────┘
             │                               │
             ▼                               │
    ┌──────────────────┐                     │
    │ Cecelia Bridge   │◄────────────────────┘
    │ (localhost:3457) │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │  Cecelia Run     │
    │  (Headless       │
    │   Claude Code)   │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │   /dev Skill     │
    │   (Engine)       │
    └──────────────────┘
```

## 展示层架构

### Cecelia-OS

```typescript
// features/n8n/api/n8n-proxy.api.ts
export const n8nApi = {
  // 简单的 API 代理，不存储任何数据
  getWorkflows: () => fetch('http://localhost:5679/api/v1/workflows'),
  getExecutions: () => fetch('http://localhost:5679/api/v1/executions'),
};
```

### autopilot

```typescript
// apps/dashboard/core/api/n8n-proxy.ts
router.get('/workflows', async (req, res) => {
  // 只做代理，不存储
  const response = await fetch('http://localhost:5679/api/v1/workflows');
  res.json(await response.json());
});
```

## 版本控制策略

### Git 工作流

```
main (稳定版本)
  ↑
  │ PR (测试通过后合并)
  │
develop (开发版本)
  ↑
  │ PR
  │
feature/* (功能分支)
```

### 部署流程

```
1. 在 feature/* 分支开发
2. PR 到 develop
3. CI 自动测试（未来添加）
4. 合并到 develop
5. 里程碑时 PR 到 main
6. 自动部署到 N8N (GitHub Actions)
```

## 灾难恢复

### 备份策略

1. **定期备份**: 每天凌晨自动从 N8N 导出到 Git
2. **手动备份**: 修改 workflow 后立即导出
3. **Git 历史**: 完整的版本历史

### 恢复流程

```bash
# 1. 从 Git 恢复
git checkout main
./scripts/deploy-to-n8n.sh

# 2. 如果 N8N 数据库损坏
docker stop n8n-self-hosted
docker volume rm n8n-self-hosted_n8n_data
docker start n8n-self-hosted
./scripts/deploy-to-n8n.sh  # 重新导入所有 workflows
```

## 未来扩展

### Code Workflows

```typescript
// cecelia-workflows/code/batch-processor.ts
export const batchProcessor = {
  name: 'batch-processor',
  trigger: 'cron',
  schedule: '0 2 * * *',
  async execute(context: WorkflowContext) {
    // 批处理逻辑
  },
};
```

### Temporal Workflows

```python
# cecelia-workflows/temporal/data_pipeline.py
@workflow.defn
class DataPipeline:
    @workflow.run
    async def run(self) -> str:
        # Temporal workflow 定义
```

## 相关文档

- [N8N Workflows](../n8n/README.md)
- [如何触发 Cecelia](../../Cecelia-OS/docs/HOW_TO_TRIGGER_CECELIA.md)
- [开发流程](../../Cecelia-OS/docs/GOLDEN-PATHS.md)
