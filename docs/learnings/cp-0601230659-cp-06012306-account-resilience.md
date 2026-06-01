## 账号凭据健壮性：429 误判 + 文件丢失（2026-06-01）

### 根本原因

两个独立 bug 让 harness 因"假性无账号"卡死：

1. **usage 接口 429 误判**：`account-usage.js` 把 usage 查询接口（`/api/oauth/usage`，高频轮询易触发的独立限流）的 429 当成账号配额耗尽，hardcode `five_hour_pct=100` 把健康账号判死。账号实际 messages API 完全能跑。

2. **凭据文件丢失无自愈**：account1（alexperfectapi01）的 `.credentials.json` 在本机从未创建（macOS 交互登录写钥匙串、不写文件；Brain 在 Docker 只读文件读不到钥匙串）→ 整天 MISSING → 单账号轮换被踢空 → pipeline 卡死。refresh cron 只能续已存在文件，不能创建。

### 下次预防

- [ ] usage 查询接口的 429 ≠ messages 配额耗尽，不可据此判账号死，应回退缓存用量
- [ ] macOS 上账号登录必须确认写出了 `.credentials.json` 文件（不只是钥匙串），否则 Brain/Docker 用不了
- [ ] 凭据文件应备份到 1Password，部署/启动时缺失自动恢复，而不是默默坏掉
- [ ] 账号"可用性"判断的任何"判死"逻辑，都要能从缓存/备份自愈，避免单点 false-positive 拖垮整条 pipeline
