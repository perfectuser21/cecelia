---
id: instruction-arch-review
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本
---

# /arch-review — 架构审查

## What it is

架构质量审查官。扫描系统架构，发现架构漂移、模块耦合问题、文档与代码不一致。
不设计新架构（那是 `/architect` 的工作），只做审查和发现。

## Trigger

两种触发方式：
1. **用户手动**：直接输入 `/arch-review`
2. **Brain 自动**：每日定时触发 `task_type=arch_review` 的任务

## How to use

```bash
# 手动触发架构审查
/arch-review

# verify 模式：验收一个 initiative 是否完成
/arch-review --mode verify --initiative-id <id>

# review 模式：全局架构健康巡检
/arch-review --mode review
```

## Output

- 架构漂移报告（哪些模块偏离了设计意图）
- 依赖异常发现（不应该存在的跨层依赖）
- 耦合警告（紧耦合模块列表）
- 建议行动项（可转为 Brain 任务）

## Added in

PR #767（2026-03-10 注册进 Brain 路由）
