---
id: instruction-dev
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本
---

# /dev — 统一开发工作流

## What it is

Cecelia 的核心编程 skill。任何会进 git 的代码改动都必须通过 `/dev`。
自动完成从 PRD 到合并 PR 的全流程，包含 CI 监控和 Learning 记录。

## Trigger

用户说以下任意内容时触发：
- "开始开发"、"加功能"、"修 bug"、"实现 XXX"
- "改代码"、"改配置"、"补测试"
- 直接输入 `/dev`

## How to use

```bash
# 手动提供 PRD
/dev

# 从 Brain 读取 Task 自动执行
/dev --task-id <task-id>
```

### 完整流程（12 步）

```
Step 0  Worktree 创建（隔离环境）
Step 1  PRD 确认
Step 2  环境检测
Step 3  分支创建（cp-MMDDHHNN-task-name）
Step 4  代码探索
Step 5  DoD 定稿
Step 6  写代码 + 测试 + Instruction Book Update
Step 7  本地验证（npm test）
Step 8  PR 创建
Step 9  CI 监控（自动修复失败）
Step 10 Learning 记录
Step 11 清理
```

## Output

- 合并到 main 的 PR
- `docs/LEARNINGS.md` 新增经验条目
- `docs/instruction-book/` 新增/更新功能说明（如有用户可见变更）

## Added in

初始系统，持续迭代中。当前版本：v12.47.x
