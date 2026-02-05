---
id: qa-decision-merge-zenithjoy
version: 1.0.0
created: 2026-02-05
updated: 2026-02-05
changelog:
  - 1.0.0: 初始版本
---

# QA Decision: 合并 zenithjoy-core → cecelia-core

**Decision**: NO_RCI
**Priority**: P1
**RepoType**: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 14 个前端 Feature 目录复制完整 | manual | manual:ls 验证 14 个目录存在 |
| 14 个新 Feature 注册到 coreFeatures | auto | manual:npm run build 编译通过 |
| Express Platform 后端移入 platform/ | manual | manual:验证目录结构完整 |
| platform/ 有独立 package.json 和 tsconfig.json | manual | manual:文件存在且配置正确 |
| 辅助文件移入（data, workflows, packages, scripts） | manual | manual:目录存在 |
| Docker Compose 新增 cecelia-platform 服务 | manual | manual:docker compose config |
| Vite Proxy 添加 platform API 代理规则 | auto | manual:npm run build |
| npm run build 编译成功 | auto | npm run build |
| Brain API 正常 | manual | manual:curl localhost:5221/api/brain/status |

## RCI

**new**: []
**update**: []

## Reason

大规模文件迁移合并，不是新功能开发。主要验证文件完整性和编译通过即可，不需要新增回归契约。

## Scope

**允许修改的范围**：
- `frontend/src/features/core/` - 新增 14 个 feature 目录
- `frontend/src/features/core/index.ts` - 注册新 features
- `frontend/vite.config.ts` - 添加 proxy 规则
- `platform/` - 新增 platform 目录（从 zenithjoy-core 迁移）
- `data/` - 迁移数据文件
- `workflows/` - 迁移工作流文件
- `packages/` - 迁移包
- `scripts/` - 迁移脚本（不覆盖已有）
- `docker-compose.yml` - 添加 platform 服务

**禁止修改的区域**：
- `brain/` - 保持职责分离
- `shared/` - cecelia-core 已是超集
