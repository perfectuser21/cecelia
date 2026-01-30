# QA Decision - TRD 分解器

Decision: NO_RCI
Priority: P1
RepoType: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| TRD 分解 API | manual | manual:调用 decompose API 验证返回 |
| 任务依赖关系 | manual | manual:检查 depends_on 字段 |
| 进度追踪 API | manual | manual:调用 progress API 验证 |

## RCI

- new: []
- update: []

## Reason

1. **Engine 类型项目**：Brain API 核心功能
2. **API 测试为主**：验证分解逻辑和数据存储
3. **手动验证**：首次实现，需观察分解结果质量

## 测试计划

### 手动验证步骤

1. **AC1 验证 - TRD 分解**：
   ```bash
   # 调用分解 API
   curl -X POST http://localhost:5212/api/brain/trd/decompose \
     -H "Content-Type: application/json" \
     -d '{
       "trd_content": "# 测试 TRD\n\n## 阶段1\n- 任务A\n- 任务B\n\n## 阶段2\n- 任务C"
     }'

   # 验证返回包含 milestones 和 tasks
   ```

2. **AC2 验证 - 依赖关系**：
   ```bash
   # 检查创建的 tasks
   curl http://localhost:5212/api/brain/tasks

   # 验证 depends_on 字段正确设置
   ```

3. **AC3 验证 - 进度追踪**：
   ```bash
   # 调用进度 API
   curl http://localhost:5212/api/brain/trd/<trd_id>/progress

   # 验证返回正确的进度百分比
   ```
