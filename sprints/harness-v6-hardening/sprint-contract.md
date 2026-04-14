# Sprint Contract Draft (Round 2)

> **修订说明**：根据 Round 1 Evaluator 反馈修复 2 个逻辑 Bug、8 个命令太弱问题。所有验证命令升级为结构性正则验证，消除纯 includes 假阳性。

---

## Workstreams

workstream_count: 3

### Workstream 1: Backend Core — Verdict 重试 + Bridge 崩溃识别

**范围**: `packages/brain/src/execution.js` 中的 verdict 评估逻辑和 bridge 崩溃处理逻辑
**大小**: M（100-300行）
**依赖**: 无

### Workstream 2: Cleanup & Lifecycle — 产物清理全链路

**范围**: `packages/engine/hooks/stop.sh` 或 `stop-dev.sh` 孤儿 worktree 清理 + `packages/brain/src/execution.js` harness_cleanup 任务 + `scripts/cleanup-stale-branches.sh` 新增脚本
**大小**: M（100-300行）
**依赖**: 无

### Workstream 3: Monitoring & UI — 完整步骤展示 + 统计 + Health

**范围**: `packages/brain/src/harness.js` pipeline-detail 步骤扩展 + stats 端点 + `packages/brain/src/health-monitor.js` callback_queue_stats + `apps/dashboard/src/` 前端适配
**大小**: L（>300行，跨后端+前端）
**依赖**: 无
