# Logs Feature

日志和审计追踪功能模块，记录系统活动和操作历史。

## 文件结构

```
logs/
├── index.ts             # 模块入口
├── logs.route.ts        # 路由定义
├── logs.repository.ts   # 数据库操作
├── logs.types.ts        # 类型定义
├── config.yaml          # 功能配置
└── CLAUDE.md            # 本文档
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /v1/logs | 创建日志条目 |
| GET | /v1/logs/recent | 获取最近日志 |
| GET | /v1/logs/action/:action | 按操作类型查询 |
| GET | /v1/logs/resource/:type/:id | 按资源查询 |

## 依赖

- `../../shared/db/connection` - 数据库连接
- `../../shared/middleware/error.middleware` - 错误处理

## 日志结构

```typescript
interface Log {
  id: number;
  user_id?: number;
  action: string;           // 操作类型
  resource_type?: string;   // 资源类型（如 platform）
  resource_id?: number;     // 资源 ID
  details?: Record<string, any>;  // 详细信息
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}
```

## 导出

- `logsRepository` - 日志数据库操作
- `Log`, `CreateLogDTO` - 类型
