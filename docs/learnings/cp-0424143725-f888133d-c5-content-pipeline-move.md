# Phase C5 — content-pipeline 搬家 Learning

## 做了什么
软搬家：
- `content-pipeline-graph.js` (625 行) → `workflows/content-pipeline.graph.js`（纯外部 imports，无 relative path 调整）
- `content-pipeline-graph-runner.js` (204 行) → `workflows/content-pipeline-runner.js`（import 路径从 `./content-pipeline-graph.js` 改 `./content-pipeline.graph.js`、`./docker-executor.js` 改 `../docker-executor.js`）
- 原两文件都变 10 行 re-export shim

## 根本原因
Phase C 目标 L2 workflow 集中。content-pipeline 是被 `routes/content-pipeline.js:27` 调的 dispatch 入口（和 harness-initiative 平级）。软搬家零 caller 改动。

## 下次预防
- [ ] 搬家顺序：graph 文件先搬 → runner 搬时 import 路径已能指向新 graph；避免"graph 还没搬，runner 先搬"的中间状态

## 关键决策
**graph + runner 两文件分开搬，非合并**：保持现有代码结构清晰（graph 纯图定义，runner 是 dispatch 入口 + Docker 节点工厂注入）。合并到单一 `.graph.js` 会让 625+204=829 行超出单文件建议长度。
