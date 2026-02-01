# QA Decision

**Decision**: NO_RCI
**Priority**: P0
**RepoType**: Business

## Tests

- **dod_item**: "API 端点 POST /api/intent/recognize 接收自然语言输入并返回结构化 JSON"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "正确识别创建 Task 意图"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "正确识别创建 Goal 意图"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "正确识别创建 Project 意图"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "正确识别查询任务意图"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "正确识别更新任务意图"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "从自然语言中提取标题/名称"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "从自然语言中提取优先级（P0/P1/P2）"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "从自然语言中提取状态（pending/in_progress/completed）"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "从自然语言中提取关联关系（属于哪个 Project/Goal）"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "对于明确的创建类请求，准确率达到 100%"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "对于模糊的请求，能够识别为创建任务并返回确认提示"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "能够区分 Goal、Project 和 Task 的语义差异"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "API 响应时间 < 500ms"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "识别结果可转换为 Brain API action 格式"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "与 Brain API 集成成功"
  - **method**: auto
  - **location**: tests/api/intent-brain-integration.test.ts

- **dod_item**: "与 Task Management API 集成，支持任务 CRUD 操作"
  - **method**: auto
  - **location**: tests/api/intent-task-integration.test.ts

- **dod_item**: "提供完整的 TypeScript 类型支持"
  - **method**: manual
  - **location**: manual:代码审查时检查 TypeScript 类型定义完整性

- **dod_item**: "单元测试覆盖核心识别逻辑"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "集成测试验证完整的识别→执行流程"
  - **method**: auto
  - **location**: tests/api/intent-end-to-end.test.ts

- **dod_item**: "至少 10 个真实场景的测试用例通过"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "npm run test 通过（vitest）"
  - **method**: auto
  - **location**: CI 自动运行

- **dod_item**: "API 文档说明接口使用方法"
  - **method**: manual
  - **location**: manual:检查 API 文档完整性

- **dod_item**: "代码注释解释关键算法逻辑"
  - **method**: manual
  - **location**: manual:代码审查时确认

- **dod_item**: "场景 1：创建 Task - 输入'实现用户登录接口'，返回正确的 CREATE_TASK 意图和实体"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "场景 2：创建 Goal - 输入'完成整个用户认证系统作为 P0 目标'，返回正确的 CREATE_GOAL 意图和 P0 优先级"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "场景 3：查询任务 - 输入'我有哪些待办任务'，返回正确的 QUERY_TASKS 意图和 pending 状态过滤"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

- **dod_item**: "场景 4：更新状态 - 输入'把登录功能标记为完成'，返回正确的 UPDATE_TASK 意图和 completed 状态"
  - **method**: auto
  - **location**: apps/core/src/__tests__/intent-recognition.test.ts

## RCI

**new**: []
**update**: []

## Reason

新增意图识别功能，属于业务功能扩展。虽然是 P0 优先级的新特性，但不涉及核心 Engine 机制（Hook/Gate/CI），不改变现有系统行为。功能独立可测，通过完善的单元测试和集成测试覆盖即可确保质量，无需纳入回归契约。
