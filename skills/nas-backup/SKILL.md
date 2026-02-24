# NAS 内容管理 Skill

## 触发方式

- `/nas <command> [args]`
- 用户提到"NAS 内容"、"管理内容"、"查看内容"

## 功能

封装 `infrastructure/scripts/nas-content-manager.sh`，提供友好的内容管理接口。

## 使用示例

```bash
/nas list                              # 列出所有内容
/nas show 2025-11-03-009a0b            # 查看详情
/nas read 2025-11-03-009a0b            # 读取文本
/nas update-status <id> ready          # 更新状态
/nas add-platform <id> xhs             # 添加平台
/nas search "AI"                       # 搜索内容
/nas filter draft                      # 筛选草稿
/nas stats                             # 统计信息
/nas create <id> <title> [type]        # 创建新内容
```

## 执行逻辑

当用户调用 `/nas` 时：

1. **解析命令**：提取命令和参数
2. **调用工具**：执行 `nas-content-manager.sh <command> [args]`
3. **格式化输出**：将结果以友好方式呈现给用户

## 命令说明

### 查询命令

- **list**: 列出所有内容
  - 输出格式：`content_id | status | type | title`

- **show <content_id>**: 查看内容详情
  - 显示 manifest.json 和文件列表

- **read <content_id> [version]**: 读取文本内容
  - version 默认为 v1

- **search <keyword>**: 搜索内容
  - 在所有 manifest.json 中搜索关键词

- **filter <status>**: 按状态筛选
  - 可用状态：draft, ready, publishing, published, failed

- **stats**: 统计信息
  - 显示总数、类型分布、状态分布

### 修改命令

- **update-text <content_id> <local_file> [version]**: 更新文本
  - 上传本地文件到 NAS
  - 更新 manifest 的 updated_at

- **update-status <content_id> <state>**: 更新状态
  - 可用状态：draft, ready, publishing, published, failed

- **add-platform <content_id> <platform>**: 添加平台
  - 可用平台：xhs, weibo, douyin, toutiao

- **upload-image <content_id> <local_file> [role]**: 上传图片
  - role 默认为 cover（可选：cover, inline, thumbnail）

### 创建命令

- **create <content_id> <title> [content_type]**: 创建新内容
  - 创建完整目录结构和 manifest.json
  - content_type 默认为 article

## 工具路径

`/home/xx/perfect21/infrastructure/scripts/nas-content-manager.sh`

## 权限

- 需要 SSH 访问 NAS（已配置无密码登录）
- 需要 jq 工具

## 错误处理

- 不存在的 content_id：返回明确错误
- 无效参数：显示用法说明
- SSH 失败：报告连接错误

## 输出格式

- 成功：显示操作结果
- 失败：显示错误信息（红色）
- 列表：表格格式或分隔符格式

## 使用场景

### 场景 1：查看草稿内容

```
用户：查看所有草稿内容
你：调用 /nas filter draft
```

### 场景 2：更新内容状态

```
用户：把 2025-11-03-009a0b 标记为准备发布
你：调用 /nas update-status 2025-11-03-009a0b ready
```

### 场景 3：搜索内容

```
用户：找所有关于 AI 的内容
你：调用 /nas search "AI"
```

### 场景 4：查看统计

```
用户：给我看看内容统计
你：调用 /nas stats
```

## 注意事项

1. **性能**：list 和 stats 命令可能较慢（160+ 内容，每个需要 SSH）
2. **网络**：依赖 Tailscale 连接到 NAS
3. **并发**：避免同时执行多个修改操作
4. **大文件**：不支持视频上传（文件过大）

## 集成

- 可以在其他 Skills 中调用（如内容发布流程）
- 可以在 N8N workflows 中使用
- 可以在 Cecelia Brain 中调度

## 相关文档

- Infrastructure 仓库：`/home/xx/perfect21/infrastructure`
- 工具文档：`scripts/nas-content-manager.sh help`
- PRD：`.prd-cp-20260210-nas-content-manager.md`
