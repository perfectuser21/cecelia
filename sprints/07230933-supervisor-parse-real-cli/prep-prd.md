# Bug PrepPRD：codex/grok headless supervisor 三态解析对不上真实 CLI 输出

任务：ab41227c-74b1-46ec-a222-0b65c6053ed7 ｜ 决策：78747a80 ｜ 设计：docs/superpowers/specs/2026-07-23-supervisor-parse-real-cli-design.md

## 症状

两个 supervisor 的 `parseDecision()` 永远 fallback `continue`（拿不到 complete/blocked 真信号）；
grok 的 `extractSessionId()` 永远 null → `--resume` 从不生效，每轮"续跑"实际开全新会话，违背 INV-5。

## 根因（已实证，非假设）

- codex `exec --json` 是 JSONL 事件流，agent 回复嵌在 `item.completed` 的 `item.text` 字符串里；代码只查顶层 `decision/status/outcome`。
- grok `--output-format json` 是单个多行 pretty JSON 对象；代码逐行 `JSON.parse` 全灭，且找 `session_id/thread_id` 而真实字段是驼峰 `sessionId`。
- 真实 CLI 输出原文 fixture 已捕获（2026-07-23，codex team1 + grok 0.2.106 实跑）。

## 修法

新建 `scripts/lib/supervisor-parse.mjs`（纯函数：codex 嵌套解析 / grok 整块解析 + 驼峰 session / 三态映射 / 保守 fallback），
两个 supervisor 删内联函数改 import。不碰 `SUPERVISOR_DEADLINE_SECONDS`（kernel sprint 1b997ed6 地盘）。

## Regression Test 计划

`tests/regression/codex-grok-launcher-supervisor/supervisor-parse-behavior.test.mjs` + 真实输出 fixture（8 个行为断言，见设计文档），
并登记进 `regression-contract.yaml` `golden_paths[]`（现有毕业测试是孤儿：contract 没登记，PR CI 不跑——一并终结）。

## 验收标准

- [ ] failing test 先 commit（commit-1，红在断言上 = proven-to-fire）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] regression-contract.yaml 登记，core-regression（PR tier）真实执行本测试
- [ ] CI 全绿
