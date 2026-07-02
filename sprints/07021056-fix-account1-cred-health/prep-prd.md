# Bug PrepPRD：account1 从未进入凭据健康监控，故障永远无人知晓

## 症状
account1 的 Claude OAuth refresh_token 从 2026-07-01 10:00 起持续 invalid_grant，但从未收到任何告警——用户是主动问"查一下 LLM 用量"时才偶然发现的。

## 根因假设
`credential-expiry-checker.js`（tick.js 每30min 调用）和 `credentials-health-scheduler.js`（每日03:00巡检）
两处的账号名单都硬编码 `ACCOUNTS = ['account2']`，注释写"account1 无凭据"——这是过时信息，account1
当前确实有凭据在正常工作（直到7/1 10:00 才坏）。因为从未被列入监控名单，account1 出故障时系统完全
不知情，也就不会告警。

此外，Claude 账号这类需要用户立即处理的告警走的是 `raise()` → 只发飞书。用户明确反馈这类提醒要走
Bark（手机推送），不要飞书。

## 关联上下文
- 决策记录：7702b938-2de2-40a2-b7b9-fac67218ee38
- 关联决策：4ce29c14（同一批调查中发现的另一个凭据问题）

## 修法
1. `credential-expiry-checker.js`：`ACCOUNTS` 加回 `'account1'`（account3 仍排除，未充值属实）
2. `credentials-health-scheduler.js`：`CLAUDE_ACCOUNTS` 同样加回 `'account1'`
3. 两处 Claude 账号告警改为调用 `sendBark()`（notifier.js 已导出），不再依赖 `raise()`/飞书

## Regression Test 计划
- credential-expiry-checker.test.js：断言 ACCOUNTS 包含 account1
- credentials-health-scheduler.test.js：断言 CLAUDE_ACCOUNTS 包含 account1；断言 Claude 账号告警调用
  sendBark 而不是走 raise()

## 验收标准
- [x] failing test 先 commit（commit-1）
- [x] 修复代码让 test 变绿（commit-2）
- [x] 已为本 bug 配 proven-to-fire 守卫（测试改前失败，改后通过，已验证）
- [ ] CI 全绿
