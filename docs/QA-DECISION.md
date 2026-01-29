# QA Decision - Cecelia Semantic Brain

Decision: RCI_REQUIRED
Priority: P1
RepoType: Business

## Analysis

### Service Overview

Cecelia Semantic Brain 是核心语义服务，提供：
- 语义搜索 (ChromaDB + OpenAI Embeddings)
- 意图解析 (Parser)
- 任务调度 (Scheduler)
- 执行规划 (Planner)
- 监控检测 (Detector)
- Agent 实时监控 (Agent Monitor)
- 任务巡逻 (Patrol)
- 状态管理 (Focus, Tick, Goals, Queue)

### Impact Assessment

- **Risk Level**: High (核心服务)
- **Affected Areas**: 所有依赖 Brain API 的系统
- **Breaking Changes**: API 变更会影响前端和其他服务

### Risk Score

| Rule | Triggered | Reason |
|------|-----------|--------|
| R1 Public API | ✅ | 提供 15+ 个公开 API 端点 |
| R2 Data Model | ✅ | PostgreSQL + ChromaDB 数据存储 |
| R3 Cross-Module | ✅ | 多模块协作 (Intelligence + State + Core) |
| R4 New Dependencies | ❌ | 无新依赖 |
| R5 Security | ❌ | 内部服务 |
| R6 Core Workflow | ✅ | Cecelia 核心依赖 |

**RISK SCORE: 4** (RCI Required)

## RCI Reference

详见 `docs/regression-contract.yaml`

### P0 - 核心功能 (必须通过)

| ID | Name | Method |
|----|------|--------|
| B1-001 | Brain API 健康检查 | auto |
| B1-002 | 语义搜索 /fusion | auto |

### P1 - 智能层 + 监控层

| ID | Name | Method |
|----|------|--------|
| B1-003 | Parser API /parse | auto |
| B1-004 | Scheduler API /schedule | auto |
| B1-005 | Execution Planner /plan | auto |
| B1-006 | Detector API /detector/* | auto |
| B1-007 | Agent Monitor API /api/agents/* | auto |
| B1-008 | Patrol API /api/patrol/* | auto |

### P2 - 状态管理

| ID | Name | Method |
|----|------|--------|
| B1-009 | Brain State API /api/brain/* | auto |

## Tests

| RCI | Test Location |
|-----|---------------|
| B1-001 | tests/test_api.py::TestAPI::test_health_endpoint |
| B1-002 | tests/test_api.py::TestAPI::test_fusion_endpoint_success |
| B1-003 | tests/test_intelligence/test_parse_api.py |
| B1-004 | tests/test_intelligence/test_schedule_api.py |
| B1-005 | tests/test_intelligence/test_planner_api.py |
| B1-006 | tests/test_intelligence/test_detector_api.py |
| B1-007 | tests/test_agent_monitor.py |
| B1-008 | tests/test_patrol_api.py |
| B1-009 | tests/test_tick_api.py |

## CI Integration

所有 RCI 通过 `pytest tests/ -v` 自动验证，在每次 PR 时运行。

```yaml
# .github/workflows/ci.yml
- name: Run tests
  run: PYTHONPATH=. pytest tests/ -v --tb=short
```
