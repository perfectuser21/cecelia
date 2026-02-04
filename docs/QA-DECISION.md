# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "创建 Task 时可以指定 goal_id"
    method: manual
    location: manual:通过 API 调用验证

  - dod_item: "查询某 Goal 下所有关联的 Tasks"
    method: manual
    location: manual:通过 API 调用验证

  - dod_item: "Task 状态变更后 Goal 进度更新"
    method: manual
    location: manual:通过 API 调用验证

RCI:
  new: []
  update: []

Reason: QA 任务，只需手动验证 API 功能，不需要新增回归契约
