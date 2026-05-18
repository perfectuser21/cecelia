# Harness Pipeline Lifecycle Smoke Test 设计

**日期**: 2026-05-18  
**分支**: cp-0518143337-harness-e2e-smoke  
**类型**: feat（新增 smoke script）  
**文件**: `packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`

---

## 问题

没有任何测试能验证「harness pipeline 跑完整流程不卡死」。已有的测试全是 mock，只有单元测试或静态结构断言，无法覆盖 Brain crash、fix loop 不接、keepalive 失效等实际运行时问题。

---

## 目标

一个可手动运行的 bash smoke 脚本：
- 向真实 Brain 注册一个 `harness_initiative` 任务
- 等待任务跑完（`completed` 或 `failed`）
- 超时（90 分钟）则报 FAIL（说明 pipeline 卡死）

**判定原则**：`completed` 和 `failed` 都算通过——目的是验证「pipeline 一定走到终态」，不要求一定写出代码。

---

## 设计

### 文件

`packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`

### 结构

```bash
#!/usr/bin/env bash
# harness-pipeline-lifecycle-smoke.sh
# 验证 harness pipeline 能跑完整流程不卡死（completed 或 failed 均为 PASS）
set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/w19-playground-sum}"
POLL_INTERVAL=60   # 秒
MAX_WAIT=5400      # 90 分钟
```

### 流程

1. **Skip guard**（依赖不满足时优雅跳过）：
   - Brain 健康检查失败 → `exit 0`（skip，不阻塞 CI）
   - `sprints/w19-playground-sum/sprint-prd.md` 不存在 → `exit 0`（skip）

2. **创建任务**：
   ```
   POST /api/brain/tasks
   { "task_type": "harness_initiative",
     "title": "[smoke] harness-pipeline-lifecycle",
     "payload": { "sprint_dir": "sprints/w19-playground-sum",
                  "smoke_test": true } }
   ```
   读取返回的 `task_id`。

3. **轮询**（每 `$POLL_INTERVAL` 秒）：
   ```
   GET /api/brain/tasks/{task_id}
   ```
   检查 `status` 字段：
   - `completed` 或 `failed` → PASS，`exit 0`
   - 其他（`queued` / `in_progress`）→ 继续等
   - `cancelled` / `error` 或 HTTP 错误 → FAIL，`exit 1`

4. **超时**：超过 `$MAX_WAIT` 秒未终态 → FAIL，`exit 1`，打印当前 status

5. **退出前输出**：打印 `task_id`、最终 `status`、`failure_reason`（如有），便于排查

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRAIN_URL` | `http://localhost:5221` | Brain API 地址 |
| `SPRINT_DIR` | `sprints/w19-playground-sum` | 测试用 PRD 目录 |
| `POLL_INTERVAL` | `60` | 轮询间隔（秒）|
| `MAX_WAIT` | `5400` | 最大等待时间（秒）|

### 错误处理

- Brain API 不可达（curl 失败）→ 继续轮询（Brain 可能在重启，keepalive 会恢复）
- 连续 5 次 curl 失败 → FAIL（Brain 已死亡且 keepalive 失效）
- 任务不存在（404）→ FAIL（task 被意外清理）

---

## 测试策略

| 类型 | 说明 |
|------|------|
| E2E（本脚本）| 真实 Brain + 真实 pipeline，跨进程，必须手动/定时触发 |
| 不进 CI | 耗时最长 90 分钟，不适合每次 PR |
| 使用方式 | `bash packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh` |
| 定时建议 | 每周一次，或 release 前手动跑 |

---

## 不在范围内

- 不验证代码质量（evaluator 结果）
- 不验证 PR 是否合并成功
- 不进 CI `real-env-smoke` job（不是本脚本的定位）
- 不添加 Brain 端任何新功能（只读/写 tasks API）
