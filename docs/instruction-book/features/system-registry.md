# System Registry (`/api/brain/registry`)

## 功能概述

`system_registry` 表统一记录 Cecelia 系统中所有组件的位置和状态，包括 skill、cron job、API 端点、机器节点、integration 等。

**核心目标**：Claude 创建任何新组件前先查这里，创建后登记进来，彻底解决孤岛和重复问题。

## API 端点

### GET `/api/brain/registry`
列表查询，支持过滤参数：
- `?type=skill|cron|api|machine|integration|other`
- `?status=active|inactive|deprecated`
- `?q=<关键词>` — 搜索 name/description/location
- `?limit=<n>` — 分页，默认 50
- `?offset=<n>` — 偏移量

**响应**: `{ items: [...], total: N }`

### GET `/api/brain/registry/exists`
检查某组件是否已注册：
- `?name=<name>&type=<type>`

**响应**: `{ exists: true/false, item: <item>|null }`

### POST `/api/brain/registry`
注册或更新组件（upsert，以 name+type 为唯一键）：
```json
{
  "name": "my-skill",
  "type": "skill",
  "location": "~/.claude/skills/my-skill/SKILL.md",
  "description": "该 skill 解决的问题",
  "status": "active",
  "metadata": {}
}
```

### PATCH `/api/brain/registry/:id`
更新已注册条目的 status、location、description 或 metadata。

## 数据表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | TEXT | 组件名（如 `/dev`、`brain-tasks`） |
| type | TEXT | 类型枚举 |
| location | TEXT | 文件路径或 URL |
| status | TEXT | active / inactive / deprecated |
| description | TEXT | 解决的问题（一句话） |
| metadata | JSONB | 额外信息（触发词、版本等） |
| updated_at | TIMESTAMPTZ | 最后更新时间 |

## 使用场景

1. **创建新 skill 前**: `GET /api/brain/registry/exists?type=skill&name=my-skill`
2. **创建后登记**: `POST /api/brain/registry` 写入记录
3. **查询所有 cron**: `GET /api/brain/registry?type=cron&status=active`
4. **标记废弃**: `PATCH /api/brain/registry/:id` with `{ "status": "deprecated" }`

## Migration

Migration 文件: `packages/brain/migrations/197_system_registry.sql`
