# Learning: deploy.yml 触发机制重构

**Branch**: cp-04081800-fix-deploy-trigger
**Date**: 2026-04-08

### 根本原因

deploy.yml 用 `push to main` 触发，AI 并行开发下一天合 10-20 个 PR，等于每天触发 10-20 次 deploy。Safe Lane 每次都失败（staging 环境未就绪），production 长期 `rolled_back`，Brain 核心代码几个月没有真正上线过。

### 下次预防

- [ ] Release 触发机制设计时，先问：merge 节奏 vs release 节奏是否需要分离？
- [ ] AI 并行开发场景下，默认不用 `push to main` 触发 deploy
- [ ] schedule/workflow_dispatch 触发时，changes job 必须走全量部署路径（不依赖 event.before/after）
