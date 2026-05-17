---
id: instruction-write-current-state
version: 1.0.0
created: 2026-03-29
updated: 2026-03-29
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本
---

# write-current-state.sh — 系统状态快照生成

## What it is

每次 `/dev` Stage 4（PR 合并后）自动运行，将当前系统健康状态写入 `.agent-knowledge/CURRENT_STATE.md`。
Claude 下次对话时读取此文件，无需重新查询 Brain API 即可感知当前状态。

## 触发时机

1. **自动触发**：`/dev` Stage 4 Ship 阶段，PR 合并后执行
2. **手动触发**：`bash scripts/write-current-state.sh`

## 输出内容

`.agent-knowledge/CURRENT_STATE.md` 包含以下章节：

| 章节 | 数据来源 |
|------|---------|
| 系统健康 | `GET /api/brain/health` + `GET /api/brain/alertness` |
| Capability Probe | `cecelia_events` 表最新 `capability_probe` 事件 |
| 进行中任务 | `GET /api/brain/tasks?status=in_progress&limit=8` |
| 最近 PR | `GET /api/brain/dev-records?limit=5` |
| P0 Issues | `GET /api/brain/tasks?priority=P0&status=blocked/failed` |

## 离线降级

Brain 离线或 API 超时（5s）时，各章节显示"（数据不可用）"占位，脚本始终以 `exit 0` 退出，不阻断 Stage 4 流程。

## Worktree 兼容

脚本通过 `git rev-parse --git-common-dir` 自动解析主仓库路径，从 worktree 中运行时也能正确写入主仓库的 `.agent-knowledge/CURRENT_STATE.md`。
