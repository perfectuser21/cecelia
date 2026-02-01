---
id: qa-decision-concurrency-optimization
version: 1.0.0
created: 2026-02-01
prd: .prd-concurrency-optimization.md
---

# QA Decision

**Decision**: NO_RCI
**Priority**: P2
**RepoType**: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 并发配置统一 (.env, .env.docker) | manual | manual: 检查文件内容包含 CECELIA_MAX_CONCURRENT=5 和 MAX_CONCURRENT=5 |
| 环境变量清理 (.env.example 合并) | manual | manual: 验证 .env.example 包含完整配置，brain/.env.example 已删除 |
| 文档更新 (README.md, DOCKER.md) | manual | manual: 检查文档准确描述启动方式 |
| 配置生效验证 (Brain 读取配置) | manual | manual: `curl http://localhost:5221/api/brain/tick/status \| jq .max_concurrent` 返回 5 |
| 服务健康检查 | manual | manual: 验证 5220, 5221 端口服务正常运行，Tick 循环启用 |
| 资源监控 (可选) | manual | manual: 检查 CPU Load < 6.4, 可用内存 > 3GB |
| 现有功能回归 | manual | manual: Tick 循环、任务派发、数据库连接正常 |
| 文件清理 | manual | manual: Git 状态干净，无临时文件遗留 |

## RCI

**new**: []
**update**: []

## Reason

配置优化，无需回归契约。此变更仅调整内部运行时参数（并发数、环境变量），不影响外部 API、数据模型或核心工作流。所有验证通过手动检查配置生效和服务健康即可。

## Scope

**允许修改的范围**：
- `.env` - 添加/更新并发配置
- `.env.docker` - 统一并发配置
- `.env.example` - 合并完整配置模板
- `brain/.env.example` - 删除（合并到根目录）
- `README.md` - 更新启动说明
- `DOCKER.md` - 标记为可选方式

**禁止修改的区域**：
- `brain/src/` - 核心业务逻辑
- `src/api/` - API 端点
- `data/` - 数据文件
- `.git/` - Git 元数据
- `node_modules/` - 依赖
