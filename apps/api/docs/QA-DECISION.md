# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "API /api/orchestrator/queue 返回正确的队列数据"
    method: auto
    location: manual:手动测试 - 调用 API 验证返回格式

  - dod_item: "API /api/orchestrator/execute-now/:id 可以插队任务"
    method: auto
    location: manual:手动测试 - 创建任务后调用插队 API

  - dod_item: "API /api/orchestrator/pause/:id 可以暂停任务"
    method: auto
    location: manual:手动测试 - 暂停运行中的任务

  - dod_item: "Realtime Config 包含 3 个工具定义"
    method: auto
    location: manual:检查 realtime config 返回的 tools 数组

  - dod_item: "语音可以调用 get_queue 查看队列"
    method: manual
    location: manual:语音测试 - 说 "现在队列里有什么"

  - dod_item: "语音可以调用 execute_now 插队任务"
    method: manual
    location: manual:语音测试 - 说 "把XX任务插队"

  - dod_item: "语音可以调用 pause_task 暂停任务"
    method: manual
    location: manual:语音测试 - 说 "暂停XX任务"

  - dod_item: "工具执行返回友好的文本反馈"
    method: manual
    location: manual:验证语音回复是否友好自然

RCI:
  new: []
  update: []

Reason: 新增语音控制功能，不涉及核心回归路径，使用手动测试验证交互体验
