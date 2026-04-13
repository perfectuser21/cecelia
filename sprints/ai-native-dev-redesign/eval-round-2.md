# Eval Round 2 — FAIL

**sprint_dir**: sprints/ai-native-dev-redesign
**eval_round**: 2
**verdict**: FAIL
**evaluated_at**: 2026-04-13T13:45:00+08:00

---

## 验证结果汇总

| Feature | 命令 | 结果 | 说明 |
|---------|------|------|------|
| F1: Post-Merge 自动部署 | 1-1 | PASS | 脚本存在且可执行 |
| | 1-2 | PASS | health check/循环/rollback/restart 结构完整 |
| | 1-3 | PASS | 超时阈值 60s <= 60s |
| | 1-4 | PASS | Dashboard 条件构建在 if 分支内 |
| F2: PR 自动 Merge | 2-1 | PASS | auto-merge step 存在，使用 gh pr merge |
| | 2-2 | PASS | 限定 harness label |
| | 2-3 | PASS | 包含重试逻辑 |
| | 2-4 | PASS | 失败时有 Brain 回写 |
| **F3: /dev Harness 极简路径** | 3-1 | **FAIL** | 04-ship.md 无 harness_mode 检测 |
| | 3-2 | PASS | fire-learnings-event.sh 存在 |
| | 3-3 | **FAIL** | harness 模式未跳过 fire-learnings-event |
| | 3-4 | PASS | devloop-check.sh 有 harness 模式检测 |
| | 3-5 | **FAIL** | stop.sh 无 harness 模式检测 |
| F4: CI Harness 模式优化 | 4-1 | PASS | harness 条件跳过存在 |
| | 4-2 | PASS | 核心 job 不受影响 |
| | 4-3 | PASS | ci-passed 有 if: always() |
| **F5: 失败回写 Brain** | 5-1 | **FAIL** | devloop-check.sh 缺少 curl PATCH 回写 |
| | 5-2 | PASS | post-merge-deploy.sh 有失败回写 |
| F6: Evaluator 时序对齐 | 6-1 | PASS | 部署成功后有状态回写 |
| | 6-2 | PASS | health check -> deployed 时序正确 |

**通过率**: 18/22 命令 PASS (81.8%)

---

## 失败原因分析

### 根本原因：WS3 #2313 未合并到 main

PR #2313（`/dev skill harness 极简路径 + 失败回写 Brain`）CI 仍在运行中（`brain-unit` IN_PROGRESS），auto-merge 尚未触发。

WS3 覆盖的文件：
- `packages/engine/skills/dev/steps/04-ship.md` — harness 双路径（F3 3-1, 3-3）
- `packages/engine/hooks/stop.sh` — harness 模式跳过确认（F3 3-5）
- `packages/engine/lib/devloop-check.sh` — curl PATCH 回写逻辑（F5 5-1）

WS1 (#2311) 和 WS2 (#2312) 已合并，对应 Feature 1/2/4/6 全部 PASS。

### 失败的 Features

- **Feature 3** (3/5 FAIL): 04-ship.md 无 harness_mode 变量、无跳过 fire-learnings-event 指令、stop.sh 无 harness 模式检测
- **Feature 5** (1/2 FAIL): devloop-check.sh 缺少 curl PATCH /api/brain/tasks 回写逻辑

---

## 对抗性观察（非阻塞）

1. **`scripts/post-merge-deploy.sh` 前 5 行无 `set -e`** — 命令失败可能被静默吞掉，建议加上
2. **WS3 auto-merge 时序** — brain-unit job 仍在运行（已超 4 分钟），一旦 CI 全绿应自动合并

---

## 修复建议

**无需代码修复** — WS3 #2313 代码已通过 contract-review，CI 正在跑。等待：
1. `brain-unit` job 完成
2. auto-merge 触发合并 WS3 到 main
3. 触发 E3 重新验证

如果 brain-unit 持续失败或 auto-merge 未触发，需要手动排查。
