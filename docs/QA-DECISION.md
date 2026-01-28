# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "Parser API 能拆解任务"
    method: auto
    location: tests/test_intelligence/test_parser.py

  - dod_item: "Scheduler API 能正确排序"
    method: auto
    location: tests/test_intelligence/test_scheduler.py

  - dod_item: "Detector 能监控 CI 失败"
    method: auto
    location: tests/test_intelligence/test_detector.py

  - dod_item: "/parse API 返回合理任务列表"
    method: auto
    location: tests/test_api/test_intelligence_routes.py

  - dod_item: "/schedule API 返回执行计划"
    method: auto
    location: tests/test_api/test_intelligence_routes.py

  - dod_item: "与 Semantic Brain 集成正常"
    method: manual
    location: manual:调用 /parse 时查询历史实现，验证返回包含 historical_context

  - dod_item: "与 Quality API 集成正常"
    method: manual
    location: manual:Parser 创建任务后，验证 Quality DB 中有对应记录

  - dod_item: "Docker 部署成功"
    method: manual
    location: manual:docker-compose up -d 启动成功，健康检查通过

RCI:
  new: []
  update: []

Reason: Business repo 新增 Intelligence 功能层，P1 优先级（重要但非核心路径），无需纳入 Engine 回归契约，依赖单元测试 + 集成测试 + 手动验证覆盖
