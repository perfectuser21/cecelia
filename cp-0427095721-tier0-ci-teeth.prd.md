# PRD: Tier 0 止血 — CI 真有牙 + 闭环回写

## 背景

4 agent 并行审计开发流程后定位 5 处致命缝隙，Tier 0 是"30 分钟止血"层：

1. **`real-env-smoke` 装样子** — `.github/workflows/ci.yml:694` 有 `continue-on-error: true`，smoke 失败 CI 仍绿。我们花了一天搞的"真路径 CI"完全没牙。
2. **`harness-v5-checks` 4 子 job 全软门禁** — `.github/workflows/harness-v5-checks.yml` 4 处 `continue-on-error: true`，注释说"1 周观察期"早过。
3. **闭环回写 Brain task status 0/5** — 最近 5 PR (#2660/#2663/#2658/#2655/#2657) 没一个把 status 回写到 Brain，Brain 永远不知任务真做完没。`engine-ship` SKILL 只在文档里建议，不真调 curl。

## 目标

让 CI 真有牙 + 闭环真闭。30 分钟内的小改动，不引入 feature，纯止血。

## 范围

### 一、`.github/workflows/ci.yml`
- 删 `real-env-smoke` job 的 `continue-on-error: true`（line 694）
- 删该行注释（"TEMP: 临时放行"）

### 二、`.github/workflows/harness-v5-checks.yml`
- 删 4 个子 job 的 `continue-on-error: true`（line 32 / 49 / 66 / 81）
- 更新顶部注释「1 周观察期」→「观察期已过，硬门禁」

### 三、`packages/engine/skills/dev/scripts/callback-brain-task.sh`（新增）
- 真调 `PATCH /api/brain/tasks/{id}` 写 status=completed + result.merged=true + pr_url
- 自动从 `.dev-mode.<branch>` 读 task_id
- 无 task_id（手动 /dev / harness）→ 静默 skip
- Brain 不可达 → warn but non-fatal
- 由 engine-ship SKILL 在 ship 阶段 invoke（user-scope SKILL 更新为后续手动动作，PR 描述里说明）

## 验收

- 下个 PR push 后，real-env-smoke 失败会真的拦 CI
- 下个 brain feat PR push 后，harness-v5-checks 4 子检查会真的拦
- 下个 /dev 任务 ship 时，调 callback-brain-task.sh 能成功 PATCH Brain task
