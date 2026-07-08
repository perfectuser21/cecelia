# skill-eval-worker 取任务原子化设计

## 背景
`packages/brain/scripts/skill-eval-worker.js` 的 `runOnce()` 目前用两条独立 SQL 取任务：
1. `SELECT task_id, staging_path FROM skill_evals WHERE status='pending' ORDER BY created_at ASC LIMIT 1`
2. `UPDATE skill_evals SET status='running', updated_at=now() WHERE task_id=$1`

为即将把 worker 部署到 mmv 常驻多实例轮询做准备，这两步之间存在竞态窗口：多个 worker 进程可能都 SELECT 到同一条 pending 记录，再各自 UPDATE 成 running，导致同一 skill 被评估两次。

## 设计
合并成一条原子 UPDATE + 子查询 + `FOR UPDATE SKIP LOCKED`：

```sql
UPDATE skill_evals
SET status = 'running', updated_at = now()
WHERE task_id = (
  SELECT task_id FROM skill_evals
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING task_id::text, staging_path
```

`FOR UPDATE SKIP LOCKED` 保证并发事务在子查询阶段就互相跳过对方已锁定的行，选取和状态迁移在同一条语句内完成，消除竞态窗口。

`rows.length === 0` 时行为与现状一致：打印"没有 pending 任务"日志并返回 null。

## 影响范围
- 仅改 `runOnce()` 内取任务这一段（原 SELECT+UPDATE 两条查询 → 一条 UPDATE...RETURNING）。
- `taskId`/`stagingPath` 的解构来源从两次查询结果改为一次 `RETURNING` 结果，变量名和后续逻辑（extractZip/findSkillDir/runClaudeEval/postComplete/markFailed）不变。
- 不改函数签名、不改调用方（`isMain` 直接执行块不变）。

## 测试策略
- **unit（主要）**：mock `pool.query`，验证新 SQL 语句结构（含 `FOR UPDATE SKIP LOCKED` 与 `RETURNING`）被正确调用，且 `rows` 为空时返回 null、不抛错。
- **并发验证**：用真实测试库（或现有测试基础设施里的 pool），插入两条 pending fixture，并发发起两次"取任务"查询（不经过完整 runOnce 的 claude spawn，只测取任务这一段），断言两次拿到的 task_id 不同且都被标记为 running。
- 现有 `skill-eval-worker.test.js` 中与 JSON 加固（`sanitizeJsonString`/`extractReportJson`）相关的测试不受影响，保持通过。
