# Learning — 硬编码账号池回归测试随账号状态漂移

分支：cp-06110930-h14-account1-in-pool
日期：2026-06-11

## 背景

h14 回归测试断言 account-usage.js ACCOUNTS「仅 account2」，但 account1 凭据 6 月恢复后已回调度池
（['account1','account2']），断言 stale 失败。

### 根本原因

账号可用性是**会随时间变化的运营状态**（凭据恢复/吊销、org 启停），而回归测试把某一时刻的
具体名单（[account2]）固化成强断言。状态一变（account1 回池），断言就 stale。测试守护的**真正
不变量**是「被 org 禁用的 account3 永不进池」，不是「池里只有 account2」。断言绑在了易变的具体
名单上，而非稳定的不变量上。

### 下次预防

- 回归测试应绑**稳定不变量**（"account3 禁止出现"），不绑**易变的具体名单**（"只有 account2"）。
  前者随运营状态变化仍成立，后者每次账号增减都误红。
- 改账号池（account-usage.js 等 ACCOUNTS 数组）时，记得同步这条回归测试的期望。
- 多处账号数组（dispatch 池 / cred 监控）范围可以不同，但"禁 account3"应三处一致。

## checklist

- [ ] 回归测试绑稳定不变量，不绑易变具体名单
- [ ] 改 ACCOUNTS 数组时同步 h14 回归测试期望
- [ ] 账号"禁用"类不变量在所有相关数组里一致
