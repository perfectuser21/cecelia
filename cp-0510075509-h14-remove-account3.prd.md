# PRD: H14 移除 account3 from ACCOUNTS hardcoded 数组

**Brain task**: 947d7dd9-9901-4ac8-b32f-7ada7d21b036
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-4

## 背景

W8 v15 ganLoop reviewer 容器 claude CLI account3 凭据 → 403 'Your organization does not have access to Claude'。retry 3 次都 403 → graph fail。

根因：用户已退订 account3 订阅，但 brain ACCOUNTS hardcoded 数组仍含 'account3'，account-rotation 仍 select 它。

## 修法

3 个 src 文件 ACCOUNTS / CLAUDE_ACCOUNTS 数组移除 'account3'：
- account-usage.js:16
- credentials-health-scheduler.js:43
- credential-expiry-checker.js:26

不删 ~/.claude-account3 凭据文件（保留以防未来恢复订阅）。
不动 tests/ 里 account3 字面量（mock 测 historical 行为）。

## 成功标准

- selectBestAccount 不再返回 account3
- W8 v16 reviewer/proposer 容器不调 account3 凭据
- credentials-health-scheduler 不再 monitor account3

## 不做

- 不引入 dynamic accounts config 系统（独立 sprint）
- 不动 H7-H13
- 不删凭据文件
