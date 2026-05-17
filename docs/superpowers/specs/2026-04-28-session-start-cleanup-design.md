# session-start.sh 清理：删除 queued 任务注入

**目标**：session 开始时不再注入"排队中 dev 任务"列表，消除 context 噪音。

**背景**：`hooks/session-start.sh` 在每次消息前查询 Brain queued dev 任务并注入上下文，形成 to-do list 式干扰。Superpowers 设计原则：进度追踪用会话内 TodoWrite，不在 session 开始时预加载任务清单。

---

## 变更范围

**文件 1：`hooks/session-start.sh`**

删除 3 处，共 ~14 行：
- 第 30 行：`QUEUED_JSON` curl 查询（`status=queued&task_type=dev&limit=3`）
- 第 53-62 行：`QUEUED_LINES` Python 格式化块
- 第 70-75 行：`if [[ -n "$QUEUED_LINES" ]]` 条件注入块

保留不动：`TASKS_JSON`（in_progress 任务）、`TASK_LINES`、`CONTEXT` 构建、系统健康 CURRENT_STATE.md 注入。

**文件 2：`apps/api/src/__tests__/brain-api-integration.test.ts`**

删除已成为死契约的 queued 相关内容：
- 第 186-187 行：describe 注释中对 queued API 调用的说明
- 第 217-247 行：`describe('GET /api/brain/tasks?status=queued&task_type=dev — session-start 查队列契约')` 整个测试块

---

## 不变更

- `status=in_progress` 查询及注入（保留，有用）
- 系统健康状态注入（保留，有用）
- session marker 机制（保留）
- 其他契约测试（保留）

---

## 测试策略

**trivial deletion（< 20 行，无新增 I/O）→ 1 unit test 即可**

DoD BEHAVIOR 验证：
```
manual:node -e "const s=require('fs').readFileSync('hooks/session-start.sh','utf8');if(s.includes('queued'))process.exit(1)"
```
验证 session-start.sh 删除后不含 `queued` 字样。

