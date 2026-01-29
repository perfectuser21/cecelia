# QA Decision - Cecelia Semantic Brain

Decision: RCI_REQUIRED
Priority: P1
RepoType: Service
CentralManaged: true

## Central Quality Service

RCI 由中央质检服务 `cecelia-quality` 统一管理：

| 配置 | 位置 |
|------|------|
| 契约定义 | `cecelia-quality/contracts/cecelia-semantic-brain.regression-contract.yaml` |
| 仓库注册 | `cecelia-quality/control-plane/repo-registry.yaml` |
| API 端点 | `http://localhost:5681/api/contracts/cecelia-semantic-brain` |

## Service Overview

Cecelia Semantic Brain 是核心语义服务，提供：
- 语义搜索 (ChromaDB + OpenAI Embeddings)
- 意图解析 (Parser)
- 任务调度 (Scheduler)
- 执行规划 (Planner)
- 监控检测 (Detector)
- Agent 实时监控 (Agent Monitor)
- 任务巡逻 (Patrol)
- 状态管理 (Focus, Tick, Goals, Queue)

## Risk Score

| Rule | Triggered | Reason |
|------|-----------|--------|
| R1 Public API | ✅ | 提供 15+ 个公开 API 端点 |
| R2 Data Model | ✅ | PostgreSQL + ChromaDB 数据存储 |
| R3 Cross-Module | ✅ | 多模块协作 (Intelligence + State + Core) |
| R4 New Dependencies | ❌ | 无新依赖 |
| R5 Security | ❌ | 内部服务 |
| R6 Core Workflow | ✅ | Cecelia 核心依赖 |

**RISK SCORE: 4** (RCI Required)

## RCI Summary

| Priority | IDs | Coverage |
|----------|-----|----------|
| P0 | B1-001, B1-002 | Health, Fusion (core) |
| P1 | B1-003 ~ B1-008 | Parser, Scheduler, Planner, Detector, Agent Monitor, Patrol |
| P2 | B1-009 | Brain State API |

## CI Integration

所有 RCI 通过 `pytest tests/ -v` 自动验证，在每次 PR 时运行。

```yaml
# .github/workflows/ci.yml
- name: Run tests
  run: PYTHONPATH=. pytest tests/ -v --tb=short
```

## Feature: Cylia Realtime + Orchestrator Tool

Decision: NO_RCI
Priority: P1
Reason: 新增 WebSocket 代理和工具函数，属于 API 扩展，测试通过手动验证

Tests:
  - dod_item: "WebSocket 连接正常"
    method: manual
    location: manual:浏览器测试 Cylia 语音对话
  - dod_item: "run_orchestrator tool 可调用"
    method: manual
    location: manual:语音说"帮我做XXX"验证
