# Learning: KR3 管理员 OpenID 标记 + setup 脚本完善

**Branch**: cp-0414220023-e1c64e7f-b339-44d7-a591-fa0912
**日期**: 2026-04-14

### 根本原因

`kr3-setup-wx-pay.sh` 只有 `--mark-done`（标记 WX_PAY 就绪），缺少对应的 `--mark-admin-oid` 选项，导致：
1. Brain DB `kr3_admin_oid_initialized` decision 无法通过脚本标记
2. `GET /api/brain/kr3/check-config` 持续返回 `adminOidReady: false`
3. 每日进度报告重复输出"管理员 OpenID 未初始化"告警

### 下次预防

- [ ] KR3 类配置脚本：每新增一个 Brain DB decision key（`kr3_xxx`），对应在脚本中同步添加 `--mark-xxx` 选项
- [ ] `kr3-config-checker.js` 有两个 key（`kr3_wx_pay_configured` + `kr3_admin_oid_initialized`），脚本必须提供同等数量的标记入口
- [ ] `--mark-admin-oid` 已使用 Brain API 优先 + psql fallback 的双路写入，符合既有模式

### 备注

WX_PAY 凭据（MCHID/V3_KEY/SERIAL_NO）仍缺失，需与支付团队协调后填入 `~/.credentials/wechat-pay.env`，再运行 `--mark-done` 完成配置。私钥已就绪（`apiclient_key.pem` PKCS#8）。
