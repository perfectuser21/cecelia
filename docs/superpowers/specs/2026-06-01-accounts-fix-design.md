# Design: ACCOUNTS 列表修正 account2+account3

## 背景
account1 缺少 .credentials.json 导致永久 AUTH_FAILED，account3 凭据有效但被 H14 误移除。
实际只有 account2 独自工作，打满 5 小时窗口。

## 改动
1. account-usage.js L16: `['account1','account2']` → `['account2','account3']`
2. account-usage.test.js: account1 断言改为 account3
3. account-usage-proactive.test.js: 账号列表期望值更新
4. smoke test: 验证 account2+account3 可用

## 验收
- CI 全绿
- Brain 部署后 account2+account3 正常调度
