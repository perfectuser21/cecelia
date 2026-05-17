# Learning: Worktree 路径从 .claude/worktrees/ 迁移到 ~/worktrees/

**分支**: cp-03312243-worktree-persistent-path
**日期**: 2026-03-31
**任务**: P1 Worktree 路径持久化

## 问题描述

Worktree 默认路径在 `.claude/worktrees/`（主仓库内部），当系统重启或 /tmp 清理（误解）后...实际上 `.claude/worktrees/` 不在 /tmp，但用户希望有一个独立于主仓库目录、更持久的存储位置。

## 解决方案

引入 `WORKTREE_BASE` 环境变量：
- 默认值：`~/worktrees`
- 路径格式：`$WORKTREE_BASE/{project-name}/{task-name}`
- 可通过环境变量覆盖，兼容旧的 `.claude/worktrees/` 路径

## 变更文件

- `packages/engine/skills/dev/scripts/worktree-manage.sh` — generate_worktree_path 改用 WORKTREE_BASE
- `packages/engine/skills/dev/scripts/worktree-gc.sh` — 安全路径检查新增 ~/worktrees/ 支持
- `packages/engine/skills/dev/steps/00-worktree-auto.md` — 版本升至 2.4.0，补充文档

### 根本原因

旧的 `.claude/worktrees/` 路径虽然不是 /tmp，但：
1. 在主仓库内部，如果主仓库目录移动或重建，worktree 会丢失引用
2. 无法通过环境变量自定义路径
3. 用户明确希望有更持久、独立的存储位置

### 下次预防

- [ ] 路径相关改动必须同步更新测试文件（`worktree-path-migration.test.ts` 有硬编码路径断言）
- [ ] 保持向后兼容：GC 安全检查要同时支持新旧路径格式
- [ ] 文档（00-worktree-auto.md）版本号必须和代码变更同步更新
