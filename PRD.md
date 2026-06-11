# PRD — h14 账号池回归测试对齐 account1 已回池

## 背景

`tests/brain/h14-remove-account3.test.js` 断言 account-usage.js 的 ACCOUNTS 数组「仅 account2（不含 account1/account3）」。但 account1 凭据已恢复（account-usage.js 行内注释「account1 凭据已恢复(Jun 2026)，与 account2 轮换」；当日运行日志 account-usage 在 account1/account2 间轮换；用户 memory ai-accounts 亦记 account1/2 为有效账号、account3 未充值不派）。实际数组已是 `['account1','account2']`，导致该断言 stale 失败。

## 决策依据（team-lead，2026-06-11）

account1 应在池里；该测试本意是「禁 account3（org 禁用）」，断言「仅 account2」是 stale。对齐为 `['account1','account2']`，保留禁 account3 的本意。

## 范围

只改 `tests/brain/h14-remove-account3.test.js` 的 account-usage.js 那条断言（account1 应在、account3 不在、account2 在）+ 同步更新 header/describe 叙述。另两条（credentials-health-scheduler.js / credential-expiry-checker.js = [account2]）不动（各自范围未含 account1，且测试通过）。不改任何 src。

## 成功标准

- h14 测试 3 条全绿，守护的不变量变为「account3 永不在任何池里」。
- account-usage.js 断言：含 account1、含 account2、不含 account3。
