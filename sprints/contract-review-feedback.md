# 合同审查反馈（第 1 轮）

**Reviewer**: sprint-contract-reviewer  
**时间**: 2026-04-08  
**决定**: REVISION

---

## 必须修改

### 1. [命令依赖先验数据] Feature B happy path 依赖 `task_run_metrics` 表有数据

```bash
TASK_ID=$(psql cecelia -t -c "SELECT task_id FROM task_run_metrics WHERE cost_usd IS NOT NULL LIMIT 1;" | tr -d ' \n')
```

**问题**：如果 `task_run_metrics` 表为空（初始环境、CI 环境），`TASK_ID` 为空字符串，curl 路径变为 `localhost:5221/api/brain/tasks//metrics`，命令以非零退出 —— **不是因为实现错误，而是因为前提条件不满足**。

**修复方向**：先用 Feature A 的测试写入一条任务（该任务会在 `tasks.result` 有数据），再用 Feature B 读取，不依赖 `task_run_metrics` 中的先验数据。

---

### 2. [缺失 fallback 路径测试] Feature B source="tasks.result" 路径没有验证命令

合同声明 `source` 字段支持 `"task_run_metrics"` / `"tasks.result"` / `"not_found"` 三个值。当前验证命令只覆盖 `task_run_metrics` 路径。

**缺失场景**：一个任务有 `tasks.result`（包含指标字段），但 `task_run_metrics` 无记录时，端点是否正确 fallback 并返回 `source="tasks.result"`？

**修复方向**：添加如下命令——创建一个已有 tasks.result 指标的任务（可直接用 Feature A 写入的任务），确认 `GET /tasks/:id/metrics` 返回 source="tasks.result" 且数据值正确。

---

### 3. [缺失 A→B 集成验证] 没有端到端联动命令

Feature A 负责写，Feature B 负责读。合同里两个 feature 的命令是独立的，没有一条命令验证"A 写入后 B 能正确读出"这个最关键的集成路径。

**修复方向**：在 Feature B 验证命令前，先复用 Feature A 生成一个有完整 result 的任务（taskId 不清理），然后在 Feature B 命令里用同一个 taskId 调 `/metrics` 接口，验证：
- 返回 200
- `total_cost_usd` 数值等于 Feature A 写入的值
- `source` 字段有效

这样两条命令形成链路，避免功能分别通过但组合失效的漏洞。

---

## 可选改进

- Feature A 的 watchdog 路径测试中，`execSync` 在 `res.on('end')` 异步回调里执行，若 Brain 对 callback 的处理是异步的，可能出现竞态（DB 查询早于写入完成）。建议加 100ms 延时或简单轮询重试（不影响 PASS/FAIL 语义）。
