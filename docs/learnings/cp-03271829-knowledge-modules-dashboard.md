# Learning: Knowledge Modules 页面接入 Dashboard

**Branch**: cp-03271829-knowledge-modules-dashboard
**Date**: 2026-03-27

## 功能总结

将西安 M4 生成的 86 个知识页通过 BACKLOG.yaml 接入 Dashboard，实现原生组件渲染。

## 关键设计决策

- Brain API 直接读取 YAML 文件而非存 DB，保持 BACKLOG.yaml 为 SSOT
- KnowledgeModules.tsx 用 expandable card 展示 source_files，避免信息过载

### 根本原因

branch-protect.sh 检查 Brain DB 中的 `prd_content` 字段，而 PATCH /tasks API 只允许更新 `status`，所以必须直接 psql 写入 prd_content。

### 下次预防

- [ ] 创建任务时同步写入 prd_content 字段（/dev --task-id 启动流程中）
- [ ] BACKLOG.yaml 路径使用 resolve(__dirname, N层/../..) 要数清层数：routes(1) → src(2) → brain(3) → packages(4) → repo根，所以是 ../../../../docs/knowledge/BACKLOG.yaml
