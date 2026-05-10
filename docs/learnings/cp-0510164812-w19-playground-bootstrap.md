# Learning — W19 Playground Bootstrap

**日期**: 2026-05-10
**分支**: cp-0510164812-w19-playground-bootstrap
**类型**: feat（新增独立子项目）

## 背景

W6-W18 18 次 harness pipeline 跑全 fail，根因是 W8 acceptance test 选错（让 generator 改 brain 自己代码、evaluator 验 brain 自己 runtime）。修了 10 PR 协议层（H7-H16）后需要一个干净的 walking skeleton bootstrap 跑通完整 pipeline，证明"代码工厂"能从 PRD 一键到 working code + 真验证。

## 根本原因

W8 类 acceptance test 在当前架构（host 上 cecelia-node-brain 不会自动重启加载新代码）下结构性不可能跑通：

- **自指环路** generator 改 brain → main 涨 → 永远改不到老版本
- **contract 数字漂移** pin brain.version 那一刻就过期，每个 PR rebuild brain 后 contract 早已对不上 main
- **evaluator 验老 brain** curl localhost:5221 是 host 上未重启的老 brain 进程，永远验老的，跟 contract pin 的对不上

playground 不踩任何根因：题目改外部代码（不是 brain）、contract 写行为约束（不 pin 数字）、evaluator 在自己 sandbox 内启 server（不依赖 host 进程）。

## 下次预防

- [x] 不让 generator 改 packages/brain/src/（避开 W8 反模式）
- [x] 不在 contract 写 `curl localhost:5221`（那是 brain，跟 playground 无关）
- [x] 不 pin cecelia 内部 version 数字
- [x] 让 evaluator 在自己 sandbox 内启 playground server（自起自验，跟 host 老进程无关）
- [x] playground 完全独立子项目（顶层目录、不进 monorepo workspace、brain/engine/workspace CI 不扫描）
- [x] 测试策略四档（unit/integration/E2E/trivial）写进 design spec

## Walking Skeleton 原则

bootstrap 只 GET /health，不加 /sum——/sum 是 W19 task 的产出物，bootstrap 加了就破坏 walking skeleton 测试目的（要让 generator container 真改代码、evaluator container 真验改后效果）。

## 跨平台交付提示

playground 是 Node.js ESM 子项目，跨 macOS/Linux 兼容。如果未来要把 walking skeleton 扩展到 Windows runtime（用户提到 rog / CNPC Windows 机器），server.js 需保持纯 JavaScript（无平台 native binding），supertest 在 Windows 也兼容，唯一需注意的是 `PLAYGROUND_PORT` env 在 Windows PowerShell 下用 `$env:PLAYGROUND_PORT` 而非 `PLAYGROUND_PORT=`。
