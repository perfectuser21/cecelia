# NAS 内容管理 Skill

## 触发方式

- `/nas <command> [args]`
- 用户提到"NAS 内容"、"管理内容"、"查看内容"

## 功能

封装 `infrastructure/scripts/nas-content-manager.sh`，提供友好的内容管理接口。

## 工具路径

`/home/xx/perfect21/infrastructure/scripts/nas-content-manager.sh`

## 使用示例

```bash
/nas list                              # 列出所有内容
/nas show 2025-11-03-009a0b            # 查看详情
/nas read 2025-11-03-009a0b            # 读取文本
/nas update-status <id> ready          # 更新状态
/nas stats                             # 统计信息
```

## 命令说明

调用时执行：`bash /home/xx/perfect21/infrastructure/scripts/nas-content-manager.sh <command> [args]`
