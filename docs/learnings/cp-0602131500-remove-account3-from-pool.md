# account3 org 禁用应移出调度池（修 #3226 回归）（2026-06-02）

## 背景

GAN verify 修复（#3239）部署后补跑 harness 验证，卡在最前面的 planner 阶段：
planner 容器被派给 account3，秒退 exit 1，graph 等不到成功回调而挂起。
容器日志：`403 — Your organization has disabled Claude subscription access for Claude Code`。

## 根本原因

#3226（B51）以"account1 无凭据、account3 凭据有效恢复使用"为由，把 ACCOUNTS 改成
`['account2','account3']`。但 account3（zenithjoy21xx）的**组织订阅当前禁用了 Claude Code 访问**
——这是 org 层面的 403，**不等于**凭据失效（auth-failed）。#3226 把"凭据文件有效"误当成"账号可用"，
于是把一个实际不可用的账号放回了轮换池。调度器轮到 account3 就 403 秒退，pipeline 卡死。

`is_auth_failed` / spending-cap 等既有熔断都不覆盖"org 禁用 403"这种 spawn 期错误，故无法自动剔除。

## 修复

ACCOUNTS 从 `['account2','account3']` 改回 `['account2']`（account1 无凭据、account3 org 禁用，
仅 account2 可用），三处同步：account-usage.js / credential-expiry-checker.js /
credentials-health-scheduler.js。

#3226 把多账号逻辑单测硬绑到了 `ACCOUNTS=[account2,account3]` 这个生产 const，导致缩成单账号后
12 个测试断裂。根因是**轮换/降级/cap-fallback 逻辑测试不该依赖生产池大小**。已给
`selectBestAccount` / `getAccountUsage` / `getSpendingCapStatus` / `isAllAccountsSpendingCapped`
加可选 `accounts` 注入参数（默认生产 ACCOUNTS）：逻辑测试注入 `['account2','account3']` 验轮换，
组合测试断言生产池就是 `['account2']`。

## 下次预防

- [ ] 往账号池加账号前，必须验证账号**真能 spawn 成功**（org 订阅 + 凭据都通），不能只看凭据文件存在。
- [ ] "凭据有效" ≠ "账号可用"：org 禁用是 403 org-disabled，与 auth-failed/quota 是不同失败类别。
- [ ] 多账号轮换/降级/cap 逻辑的单测必须通过注入账号列表测试，禁止依赖生产 ACCOUNTS const 的大小/成员，
      否则改生产池就连带炸一片测试（本次 #3226 实证 12 个）。
- [ ] 考虑后续给 spawn 加 403「organization has disabled」自动剔除（本次用户选了手改 ACCOUNTS，未做自动化）。
