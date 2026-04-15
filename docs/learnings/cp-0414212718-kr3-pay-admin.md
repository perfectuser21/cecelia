# Learning: KR3 支付商户号 + 管理员 OpenID 自动检测

**Branch**: cp-0414212718-e1c64e7f-b339-44d7-a591-fa0912  
**Date**: 2026-04-15

### 根本原因

Brain 的 `kr3-config-checker.js` 存在两个问题：
1. **env var 名称不匹配**：`checkKR3Config()` 检查 `WX_PAY_MCH_ID`/`WX_PAY_API_KEY_V3`/`WX_PAY_APP_ID`，但 miniapp 实际使用 `WX_PAY_MCHID`/`WX_PAY_V3_KEY`/`WX_PAY_SERIAL_NO`，导致 Brain 永远读不到正确配置。
2. **缺少本地自动检测**：Brain 无法感知 `~/.credentials/wechat-pay.env` 中的配置状态，用户只能手动调用 API 标记，增加了额外的运维步骤。

管理员 OpenID 已通过之前 PR 配置为内置 fallback（`o2lLz62X0iyQEYcpnS2ljUvXlHF0`），Brain DB 中 `adminOidReady: true`。本次任务中该项已就绪，无需额外代码。

### 下次预防

- [ ] Brain 中读取 miniapp 配置时，与 miniapp 代码对照确认 env var 命名（命名不统一是跨仓库协作的常见陷阱）
- [ ] 任何"人工标记"步骤，考虑是否可以通过读取本地文件自动化（减少手动运维）
- [ ] WX_PAY 三个商户号参数（MCHID/V3_KEY/SERIAL_NO）只能从微信商户平台获取，属于人工操作范畴，不应期望 agent 自动完成

### 变更摘要

**cecelia（本 PR）**：
- `kr3-config-checker.js`：修复 env var 名称 + 新增 `readLocalPayCredentials()` + `autoMarkKR3IfLocalCredentialsReady()`
- `routes/kr3.js`：新增 `GET /kr3/local-credentials-status` + `POST /kr3/auto-mark-wx-pay`
- 测试：`kr3-config-checker.test.js` 从 7 个扩展至 16 个

**zenithjoy-miniapp（已合并 PR #30）**：
- `scripts/setup-credentials.js`：检查支付配置状态，自动提取私钥
- `docs/launch-checklist.md`：P0 阻断项精确化
