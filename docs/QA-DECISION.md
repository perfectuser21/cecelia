# QA Decision - Task Intelligence

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "Parser - Intent Analyzer 识别意图类型"
    method: auto
    location: tests/test_intelligence/test_intent_analyzer.py

  - dod_item: "Parser - Task Decomposer 拆解任务"
    method: auto
    location: tests/test_intelligence/test_task_decomposer.py

  - dod_item: "Parser - Dependency Builder 构建依赖图"
    method: auto
    location: tests/test_intelligence/test_dependency_builder.py

  - dod_item: "Scheduler - Priority Calculator 计算优先级"
    method: auto
    location: tests/test_intelligence/test_scheduler.py

  - dod_item: "Scheduler - Dependency Solver 拓扑排序"
    method: auto
    location: tests/test_intelligence/test_scheduler.py

  - dod_item: "Detector - 监控 CI/Code/Security"
    method: auto
    location: tests/test_intelligence/test_detector.py

  - dod_item: "Planner - ExecutionPlanner 生成执行图"
    method: auto
    location: tests/test_intelligence/test_planner.py

  - dod_item: "API - /parse 端点"
    method: auto
    location: tests/test_intelligence/test_parse_api.py

  - dod_item: "API - /schedule 端点"
    method: auto
    location: tests/test_intelligence/test_schedule_api.py

  - dod_item: "API - /detector 端点"
    method: auto
    location: tests/test_intelligence/test_detector_api.py

  - dod_item: "API - /plan 端点"
    method: auto
    location: tests/test_intelligence/test_planner_api.py

RCI:
  new: []
  update: []

Reason: Business repo 新增 Intelligence 功能层，P1 优先级（重要但非核心路径），无需纳入回归契约。通过单元测试覆盖核心逻辑。
