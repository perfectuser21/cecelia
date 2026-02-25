---
id: qa-decision-quality-activation
version: 1.0.0
created: 2026-01-29
updated: 2026-01-29
changelog:
  - 1.0.0: Quality Activation QA Decision
---

# QA Decision

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| GET /api/repos 返回所有注册仓库 | auto | tests/api/registry.test.ts |
| POST /api/repos/discover 发现未注册仓库 | auto | tests/api/registry.test.ts |
| GET /api/contracts/:repoId 返回 RCI 列表 | auto | tests/api/contracts.test.ts |
| POST /api/execute 触发仓库质检 | auto | tests/api/executor.test.ts |
| GET /api/dashboard/overview 返回健康概览 | auto | tests/api/dashboard.test.ts |

## RCI

### New RCIs

| ID | Name | Scope | Priority | Triggers |
|----|------|-------|----------|----------|
| C-REGISTRY-API-001 | Registry API CRUD | /api/repos 端点正常工作，支持列表、详情、注册、删除、发现 | P0 | PR, Release |
| C-CONTRACT-API-001 | Contract API 查询 | /api/contracts 端点正常工作，支持列表、仓库契约、单个 RCI 详情 | P0 | PR, Release |
| C-EXECUTE-ENGINE-001 | 执行引擎 | /api/execute 能触发远程仓库质检并返回 RCI 结果 | P0 | PR, Release |
| C-DASHBOARD-API-001 | Dashboard 数据聚合 | /api/dashboard/overview 返回所有仓库健康状态聚合 | P1 | PR, Release |

### Update RCIs

None

## Reason

Quality 激活是核心功能，将静态配置文件变为可用 API。所有主要端点（Registry、Contract、Execute、Dashboard）都是 Must-never-break 的稳定接口，必须纳入回归契约。
