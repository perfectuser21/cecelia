# Learning: KR3 小程序配置加速 — miniprogram-ci 限制发现

**Branch**: cp-0413084735-98f59188-9b0e-4612-9df2-b76889
**日期**: 2026-04-13
**任务**: [SelfDrive] KR3 小程序：加速完成上线前置条件（商户号 + OpenID 替換）

---

### 根本原因

Brain 自动调度的 KR3 任务描述了"PR#13 待合并 + 商户号/OpenID 替換"，但执行时这些工作已由前序任务（PR#13-#27）完成。任务描述脱节于实际代码状态。

本次执行还发现：**miniprogram-ci 无法部署云函数到 `zenithjoycloud-8g4ca5pbb5b027e8`**（错误：env not found）。原因是该云环境与微信开发者账号绑定，不通过腾讯云 SecretId 认证。tcb CLI 也无法访问此环境（同样 "env not found"）。

### 结论

1. **管理员 OpenID 无需手动替換**：`checkAdmin` 已实现三层 fallback（DB → env → 内置）
2. **支付商户号无法自动配置**：需微信商户平台人工开户申请
3. **云函数部署无法通过 CI 自动化**：只能在 CN Mac mini 微信开发者工具中手动上传
4. **miniprogram-ci `uploadFunction` 需要开发者工具登录态**，不支持无头模式

### 下次预防

- [ ] SelfDrive 创建 KR3 相关任务前，先 `curl localhost:5221/api/brain/kr3` 检查当前实际代码进度，避免调度已完成的任务
- [ ] 云函数部署任务应标记为 `requires_human: true`，Brain 不应自动派发给 agent
- [ ] miniprogram-ci 认证问题：WeChat Cloud 环境需要 `process.env.WX_CLOUD_DEVELOPER_KEY`（开发者 token），不是普通 CI key
