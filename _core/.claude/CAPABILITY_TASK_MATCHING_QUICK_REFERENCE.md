# 能力-任务匹配系统快速参考

## 核心映射关系

### Task Type → Location → Agent

```
task_type       location  agent          model      permissions
─────────────────────────────────────────────────────────────────────
dev             US        /dev           Opus       bypassPermissions
review          US        /review        Sonnet     plan (readonly)
qa / qa_init    US        /review init   Sonnet     plan
audit           US        /review        Sonnet     plan
exploratory     US        /exploratory   Opus       bypassPermissions
talk            HK        /talk          MiniMax    bypassPermissions
research        HK        /talk          MiniMax    bypassPermissions
data            HK        N8N            N8N        -
```

## 关键文件与行号速查

| 功能 | 文件 | 行号 | 函数 |
|------|------|------|------|
| **位置路由** | task-router.js | 44-53 | LOCATION_MAP |
| **位置查询** | task-router.js | 93-100 | getTaskLocation() |
| **Skill 映射** | executor.js | 656-669 | getSkillForTaskType() |
| **权限模式** | executor.js | 690-704 | getPermissionModeForTaskType() |
| **快速路由** | thalamus.js | 490-600 | quickRoute() |
| **Action 白名单** | thalamus.js | 142-187 | ACTION_WHITELIST |
| **LLM 路由** | thalamus.js | 359-409 | analyzeEvent() |
| **KR 评分** | planner.js | 45-78 | scoreKRs() |
| **PR Plans 调度** | planner.js | 302-347 | planNextTask() |
| **派发流程** | executor.js | 1044-1207 | triggerCeceliaRun() |
| **资源检查** | executor.js | 180-246 | checkServerResources() |

## 快速检索

### 我要添加新的 task_type

1. 在 `task-router.js` 的 `LOCATION_MAP` 中添加（第 44-53 行）
2. 在 `executor.js` 的 `getSkillForTaskType()` 中添加（第 656-669 行）
3. 在 `executor.js` 的 `getPermissionModeForTaskType()` 中添加（第 690-704 行）
4. 在 `tick.js` 的 `TASK_TYPE_AGENT_MAP` 中添加（第 35-45 行）
5. 在 `thalamus.js` 的 `ACTION_WHITELIST` 中添加相关 action（如需要）
6. 添加单元测试

### 我要添加新的 action（Thalamus 白名单）

1. 在 `thalamus.js` 的 `ACTION_WHITELIST` 中添加（第 142-187 行）
2. 在 `decision-executor.js` 中实现该 action 的处理
3. 如果是"危险"操作，设置 `dangerous: true`
4. 添加测试覆盖

### 我要修改 KR 评分算法

1. 在 `planner.js` 的 `scoreKRs()` 中修改权重（第 45-78 行）
2. 记录权重变更日志（注释或文档）
3. 运行回归测试：`npm test -- planner.test.js`
4. 监控派发顺序的变化

### 我要调试派发流程

1. 查看 task 的 `task_type` 字段
2. 调用 `POST /api/brain/route-task` 获取路由信息
3. 查看 `POST /api/brain/route-task-create` 的输出
4. 检查资源：`GET /api/brain/watchdog`
5. 检查 billing pause：`GET /api/brain/executor/status`
6. 查看执行日志：`curl http://localhost:5221/api/brain/tasks/{taskId}/logs`

## 性能指标

### 快速路由 (Level 0)
- 成本：0（纯代码）
- 延迟：< 1ms
- 覆盖率：约 60% 的事件
- 示例：heartbeat、normal tick、task completed

### LLM 路由 (Level 1 - Sonnet)
- 成本：$0.003/1K input tokens
- 延迟：1-3 秒
- 覆盖率：约 35% 的事件
- 示例：任务失败、OKR 更新、异常处理

### 深度思考 (Level 2 - Opus)
- 成本：$0.015/1K input tokens
- 延迟：5-10 秒
- 覆盖率：约 5% 的事件
- 示例：RCA、战略调整、复杂决策

## 资源限制

### 派发前检查

```
✓ CPU Load < 85% × CPU_CORES
✓ Memory Available > 15% × TOTAL_MEM + 1000MB
✓ Swap Used < 70%
✓ Billing Pause 未激活
✓ Task 不在运行中 (activeProcesses)
```

### 动态座位分配

```
pressure < 0.5  → 100% 的座位
pressure 0.5-0.7 → 67% 的座位
pressure 0.7-0.9 → 33% 的座位
pressure > 0.9  → 1 座位
pressure > 1.0  → 0 座位（拒绝派发）
```

## 常见问题

### Q: Task 为什么没有被派发？

检查项：
1. Task status == 'queued'?
2. Task type 在 LOCATION_MAP 中?
3. 资源充足？(`GET /api/brain/watchdog`)
4. Billing pause 激活？(`GET /api/brain/executor/status`)
5. 项目有 repo_path?
6. KR 评分高于其他 KR?

### Q: 任务派发到错误的 Agent？

1. 检查 task.task_type
2. 验证 LOCATION_MAP 映射
3. 验证 getSkillForTaskType() 映射
4. 运行 `POST /api/brain/route-task` 测试

### Q: 权限不足错误

检查 permission_mode：
- `bypassPermissions` - 可以修改文件
- `plan` - 只读，不能修改文件

在 `getPermissionModeForTaskType()` 中验证映射。

### Q: 如何强制派发特定任务？

1. 更新任务优先级为 P0
2. 将其添加到日焦点
3. 调用 `POST /api/brain/plan-next-task` 强制规划
4. 调用 `POST /api/brain/tick` 触发派发

### Q: 如何暂停所有派发？

```bash
# 设置 billing pause
curl -X POST http://localhost:5221/api/brain/executor/billing-pause \
  -H "Content-Type: application/json" \
  -d '{"resetTime": "2026-02-19T12:00:00Z", "reason": "cost_control"}'

# 验证
curl http://localhost:5221/api/brain/executor/status | jq .billing_pause
```

## 数据库查询速查

### 查看所有 task_type 的分布

```sql
SELECT task_type, COUNT(*) as count, 
       COUNT(CASE WHEN status='completed' THEN 1 END) as completed
FROM tasks
GROUP BY task_type
ORDER BY count DESC;
```

### 查看 KR 评分（最后一次规划）

```sql
SELECT id, title, priority, progress, created_at
FROM goals
WHERE type IN ('kr', 'global_kr', 'area_kr')
  AND status NOT IN ('completed', 'cancelled')
ORDER BY 
  CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
  (100 - progress) DESC
LIMIT 10;
```

### 查看派发历史

```sql
SELECT task_id, task_type, status, 
       (payload->>'current_run_id') as run_id,
       (payload->>'run_triggered_at') as triggered_at
FROM tasks
WHERE status IN ('in_progress', 'completed', 'failed')
ORDER BY updated_at DESC
LIMIT 20;
```

### 查看失败任务与重试

```sql
SELECT id, title, task_type, 
       (payload->>'retry_count')::int as retries,
       (payload->>'failure_reason') as reason
FROM tasks
WHERE status IN ('failed', 'quarantined')
ORDER BY updated_at DESC
LIMIT 10;
```

## 性能优化技巧

1. **减少 LLM 调用**
   - 优化 quickRoute() 规则，增加 Level 0 覆盖率
   - 预先标记简单 vs 复杂事件

2. **加速派发**
   - 批量检查资源（避免每个 task 单独检查）
   - 缓存 repo_path 解析结果

3. **降低成本**
   - 对简单任务使用 Sonnet（而非 Opus）
   - 对 HK 任务使用 MiniMax（成本更低）

4. **提高可靠性**
   - 增加 fallback agent 支持
   - 添加健康检查（agent 在线？）
   - 实现能力约束检查

---

**更新日期**: 2026-02-18  
**版本**: v1.0  
**相关文档**: CAPABILITY_TASK_MATCHING_ANALYSIS.md
